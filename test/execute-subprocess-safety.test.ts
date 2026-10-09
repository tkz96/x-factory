// test/execute-subprocess-safety.test.ts — Subprocess safety at the Worker seam: sanitized verification env and process cleanup on stop.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import { execStrict } from "../src/proc.js";
import { stopRun } from "../src/runs.js";
import { Worker } from "../src/worker.js";
import {
  baselinePathFor,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";

const PROJECT_ID = "proj-subproc-safety";

let tempDir: string;
let repo: string;
let binDir: string;
let artifactsDir: string;
let originalPath: string;
let configPath: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;
const previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;
const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
const previousGithubToken = process.env.GITHUB_TOKEN;

async function write(relPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(repo, relPath)), { recursive: true });
  await writeFile(path.join(repo, relPath), content);
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-subproc-safety-"));
  repo = path.join(tempDir, "repo");
  binDir = path.join(tempDir, "bin");
  artifactsDir = path.join(tempDir, "artifacts");

  await mkdir(binDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  originalPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${originalPath}`;
  configPath = path.join(tempDir, "projects.json");
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = configPath;

  // Create fake sbx on PATH that marks tasks done and makes an implementation edit
  const mockSbxPath = path.join(binDir, "sbx");
  const sbxScript = `#!/usr/bin/env bash
if [[ -f .agent/tasks.md ]]; then
  awk '/- \\[ \\]/ && !done { sub(/- \\[ \\]/, "- [x]"); done=1 } 1' .agent/tasks.md > .agent/tasks.md.tmp
  mv .agent/tasks.md.tmp .agent/tasks.md
fi
echo "export const updated = true;" > src/app.ts
exit 0
`;
  await writeFile(mockSbxPath, sbxScript);
  await chmod(mockSbxPath, 0o755);

  // Initialize git repo
  await execStrict("git", ["init", "--initial-branch=main", repo], {
    envPolicy: "inherit",
  });
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    envPolicy: "inherit",
    cwd: repo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    envPolicy: "inherit",
    cwd: repo,
  });
  await write("README.md", "# Fixture\n");
  await write("src/app.ts", "export const app = 1;\n");
  await execStrict("git", ["add", "-A"], { envPolicy: "inherit", cwd: repo });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: repo,
  });

  await saveRecordedBaseline(
    baselinePathFor(artifactsDir),
    await recordBaseline(repo),
  );
});

afterEach(async () => {
  process.env.PATH = originalPath;
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;

  if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;

  if (previousGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = previousGithubToken;

  await rm(tempDir, { recursive: true, force: true });
});

describe("Subprocess safety at Worker seam", () => {
  it("verification commands cannot read worker secrets from environment", async () => {
    // Inject worker credentials into process.env
    process.env.ANTHROPIC_API_KEY = "sk-worker-secret-anthropic";
    process.env.GITHUB_TOKEN = "ghp_worker_secret_github";

    // testCommand asserts that worker secrets are absent from its environment
    const testCommand = `node -e '
      const secrets = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"];
      const leaked = secrets.filter(k => process.env[k]);
      if (leaked.length > 0) {
        console.error("Secrets leaked to verification:", leaked.join(", "));
        process.exit(1);
      }
      console.log("Verification environment clean");
      process.exit(0);
    '`;

    await writeFile(
      configPath,
      JSON.stringify({
        projects: [
          {
            id: PROJECT_ID,
            name: "Subprocess Safety Project",
            repositoryPath: repo,
            defaultBranch: "main",
            testCommand,
          },
        ],
      }),
    );

    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);

    const run = runRepo.create({
      id: "run-worker-secret-check",
      projectId: PROJECT_ID,
      projectName: "Subprocess Safety Project",
      ticket: { id: "SEC-1", title: "Secret Check", acceptanceCriteria: [] },
      plan: "1. Update app",
      branch: "main",
      status: "executing",
      artifactsDir,
      worktreePath: repo,
    });
    jobRepo.createJob({ runId: run.id, stage: "execute", status: "pending" });

    const executor = new ExecuteExecutor({
      loadSettings: async () => ({}),
      reviewExecutor: {
        stage: "review",
        execute: async () => ({
          outcome: "passed",
        }),
      },
    });

    const worker = new Worker({
      workerId: "worker-safety-test",
      db,
      getStageExecutor: () => executor,
    });

    const claimed = jobRepo.claimNextJob("worker-safety-test", 30_000);
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    const after = runRepo.get(run.id);
    expect(after?.verification?.passed).toBe(true);
    expect(after?.status).toBe("awaiting_review");
  });

  it("stopping a run kills verification commands and their child processes", async () => {
    const pidFile = path.join(tempDir, "grandchild.pid");
    // testCommand spawns a grandchild sleeping in background and waits
    const testCommand = `sh -c 'sleep 60 & echo $! > "${pidFile}"; wait'`;

    await writeFile(
      configPath,
      JSON.stringify({
        projects: [
          {
            id: PROJECT_ID,
            name: "Subprocess Safety Project",
            repositoryPath: repo,
            defaultBranch: "main",
            testCommand,
          },
        ],
      }),
    );

    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const commandRepo = new CommandRepository(db);
    const eventRepo = new EventRepository(db);

    const run = runRepo.create({
      id: "run-worker-abort-check",
      projectId: PROJECT_ID,
      projectName: "Subprocess Safety Project",
      ticket: { id: "ABORT-1", title: "Abort Check", acceptanceCriteria: [] },
      plan: "1. Update app",
      branch: "main",
      status: "executing",
      artifactsDir,
      worktreePath: repo,
    });
    jobRepo.createJob({ runId: run.id, stage: "execute", status: "pending" });

    const executor = new ExecuteExecutor({
      loadSettings: async () => ({}),
    });

    const worker = new Worker({
      workerId: "worker-abort-test",
      db,
      getStageExecutor: () => executor,
    });

    // Start processing in background via worker.stepRun
    const processPromise = worker.stepRun(run.id);

    let grandchildPid = 0;
    try {
      // Poll until the verification command writes the grandchild PID (~5s)
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && grandchildPid === 0) {
        try {
          const parsed = parseInt((await Bun.file(pidFile).text()).trim(), 10);
          if (parsed > 0) grandchildPid = parsed;
        } catch {
          // file not yet written
        }
        if (grandchildPid === 0) await new Promise((r) => setTimeout(r, 50));
      }

      expect(grandchildPid).toBeGreaterThan(0);

      // Drive a real run stop command through the Worker
      await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });
      await worker.stepCommandOnce();
      await processPromise;

      // Assert that the verification grandchild is gone
      let alive = true;
      for (let i = 0; i < 20; i++) {
        try {
          process.kill(grandchildPid, 0);
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          alive = false;
          break;
        }
      }
      expect(alive).toBe(false);

      // Assert that the run ends in the stopped state
      const finalRun = runRepo.get(run.id);
      expect(finalRun?.status).toBe("stopped");
    } finally {
      // Abort any in-flight verification, wait for it, then reap the pid.
      await worker.stop();
      await processPromise.catch(() => {});
      if (grandchildPid > 0) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // ignore cleanup error
        }
      }
    }
  });
});
