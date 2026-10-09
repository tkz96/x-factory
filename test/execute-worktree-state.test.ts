// test/execute-worktree-state.test.ts — Change classification through the execute stage (Worker seam, real temp git repo, real runVerification).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import { execStrict } from "../src/proc.js";
import type { VerificationResult } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import {
  baselinePathFor,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";

const PROJECT_ID = "proj-exec-state";

let tempDir: string;
let repo: string;
let artifactsDir: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;
const previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;

async function write(relPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(repo, relPath)), { recursive: true });
  await writeFile(path.join(repo, relPath), content);
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-execute-state-"));
  repo = path.join(tempDir, "repo");
  artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = path.join(tempDir, "projects.json");
  await writeFile(
    process.env.X_FACTORY_CONFIG_PATH,
    JSON.stringify({
      projects: [
        {
          id: PROJECT_ID,
          name: "Execute State Project",
          repositoryPath: repo,
          defaultBranch: "main",
          testCommand: "true",
        },
      ],
    }),
  );

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
  await write(".env", "TOKEN=committed\n");
  await write(".gitignore", "node_modules/\n");
  await write(".github/workflows/ci.yml", "name: ci\n");
  await write(".agent/tasks.md", "- [ ] old task\n");
  await execStrict("git", ["add", "-A"], { envPolicy: "inherit", cwd: repo });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: repo,
  });

  // Preparation records the baseline before the execute stage runs.
  await saveRecordedBaseline(
    baselinePathFor(artifactsDir),
    await recordBaseline(repo),
  );
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;
  await rm(tempDir, { recursive: true, force: true });
});

/** A Ralph Loop stand-in: applies the agent's edits to the worktree, then exits 0. */
function agentSpawn(edits: () => Promise<void>): typeof spawn {
  return ((_cmd: string, _args?: readonly string[]) => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal ChildProcess stand-in
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    edits().then(() => child.emit("close", 0));
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
}

async function execute(edits: () => Promise<void>): Promise<{
  status: string | undefined;
  diff: string | null | undefined;
  verification: VerificationResult | null | undefined;
}> {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const run = runRepo.create({
    id: "run-exec-state",
    projectId: PROJECT_ID,
    projectName: "Execute State Project",
    ticket: { id: "E-1", title: "Change things", acceptanceCriteria: [] },
    plan: "1. Change things",
    branch: "main",
    status: "executing",
    artifactsDir,
    worktreePath: repo,
  });
  jobRepo.createJob({ runId: run.id, stage: "execute", status: "pending" });

  const executor = new ExecuteExecutor({
    spawn: agentSpawn(edits),
    loadSettings: async () => ({}),
    reviewExecutor: {
      stage: "review",
      execute: async () => ({
        status: "success",
        nextRunStatus: "awaiting_review",
      }),
    },
    MAX_REPAIR_ATTEMPTS: 1,
  });
  const worker = new Worker({
    workerId: "worker-exec-state",
    db,
    getStageExecutor: () => executor,
  });

  const job = jobRepo.claimNextJob("worker-exec-state", 30_000);
  if (!job) throw new Error("Expected a pending execute job");
  await worker.processJob(job);

  const after = runRepo.get(run.id);
  return {
    status: after?.status,
    diff: after?.diff,
    verification: after?.verification,
  };
}

/** Paths named by `diff --git a/<path> b/<path>` headers. */
function diffPaths(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(.+) b\/\1$/gm)]
    .map((m) => m[1] as string)
    .sort();
}

describe("Execute stage change classification", () => {
  it("reports exact changed paths, including a new file with a space in its name", async () => {
    const outcome = await execute(async () => {
      await write("src/app.ts", "export const app = 2;\n");
      await write("src/new feature.ts", "export const f = 1;\n");
    });

    expect(outcome.status).toBe("awaiting_review");
    expect(outcome.verification?.passed).toBe(true);
    expect([...(outcome.verification?.filesChanged ?? [])].sort()).toEqual([
      "src/app.ts",
      "src/new feature.ts",
    ]);
  });

  it("builds the diff from the same paths as filesChanged: new files in, scaffold out", async () => {
    const outcome = await execute(async () => {
      await write("src/app.ts", "export const app = 2;\n");
      await write("src/new feature.ts", "export const f = 1;\n");
    });

    const filesChanged = [...(outcome.verification?.filesChanged ?? [])].sort();
    expect(diffPaths(outcome.verification?.diff ?? "")).toEqual(filesChanged);
    expect(diffPaths(outcome.diff ?? "")).toEqual(filesChanged);
    expect(outcome.diff).toContain("+export const f = 1;");
    expect(outcome.diff).not.toContain(".agent/");
    expect(outcome.diff).not.toContain("ralph.sh");
  });

  it("fails verification when the agent modifies a tracked .env", async () => {
    const outcome = await execute(async () => {
      await write("src/app.ts", "export const app = 2;\n");
      await write(".env", "TOKEN=leaked\n");
    });

    expect(outcome.status).not.toBe("awaiting_review");
    expect(outcome.verification?.passed).toBe(false);
    expect(outcome.verification?.hasPollution).toBe(true);
    expect(
      outcome.verification?.pollutionDetails?.some((d) => d.includes('".env"')),
    ).toBe(true);
    expect(outcome.verification?.filesChanged).toEqual(["src/app.ts"]);
  });

  it("treats changes under .github/ and to .gitignore as implementation", async () => {
    const outcome = await execute(async () => {
      await write(".github/workflows/ci.yml", "name: ci-changed\n");
      await write(".github/dependabot.yml", "version: 2\n");
      await write(".gitignore", "node_modules/\ndist/\n");
    });

    expect(outcome.status).toBe("awaiting_review");
    expect(outcome.verification?.passed).toBe(true);
    expect([...(outcome.verification?.filesChanged ?? [])].sort()).toEqual([
      ".github/dependabot.yml",
      ".github/workflows/ci.yml",
      ".gitignore",
    ]);
    expect(diffPaths(outcome.diff ?? "")).toEqual([
      ".github/dependabot.yml",
      ".github/workflows/ci.yml",
      ".gitignore",
    ]);
  });
});
