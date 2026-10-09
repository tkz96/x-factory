// test/attempt-loop.test.ts — The attempt loop at the Worker seam: fake `sbx` on PATH, a real temp git repo, real verification.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAttemptLoop } from "../src/attempt-loop.js";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageExecutor } from "../src/executors/types.js";
import { execStrict } from "../src/proc.js";
import { stopRun } from "../src/runs.js";
import type { loadSettings } from "../src/settings.js";
import type { Project } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import {
  baselinePathFor,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";
import {
  PASSING_REVIEW_OUTPUT,
  scriptedReviewSession,
} from "./helpers/scripted-review-session.js";

const PROJECT_ID = "proj-attempt-loop";

let tempDir: string;
let repo: string;
let binDir: string;
let artifactsDir: string;
let originalPath: string;
let configPath: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;
const previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "HTTP_PROXY",
  "PI_API_KEY",
];

async function write(relPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(repo, relPath)), { recursive: true });
  await writeFile(path.join(repo, relPath), content);
}

async function git(...args: string[]): Promise<void> {
  await execStrict("git", args, { envPolicy: "inherit", cwd: repo });
}

/** Installs a fake `sbx` whose body runs once per agent invocation, inside the worktree. */
async function installSbx(body: string): Promise<void> {
  const sbxPath = path.join(binDir, "sbx");
  await writeFile(sbxPath, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(sbxPath, 0o755);
}

const CHECK_OFF_FIRST_TASK = `awk '/- \\[ \\]/ && !done { sub(/- \\[ \\]/, "- [x]"); done=1 } 1' .agent/tasks.md > .agent/tasks.md.tmp && mv .agent/tasks.md.tmp .agent/tasks.md`;

async function configureProject(testCommand: string): Promise<void> {
  await writeFile(
    configPath,
    JSON.stringify({
      projects: [
        {
          id: PROJECT_ID,
          name: "Attempt Loop Project",
          repositoryPath: repo,
          defaultBranch: "main",
          testCommand,
        },
      ],
    }),
  );
}

const PASSING_REVIEW: StageExecutor = {
  stage: "review",
  execute: async () => ({
    outcome: "passed",
  }),
};

type Settings = Awaited<ReturnType<typeof loadSettings>>;

function setup(
  settings: Settings = {},
  reviewExecutor: StageExecutor = PASSING_REVIEW,
) {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const commandRepo = new CommandRepository(db);
  const eventRepo = new EventRepository(db);
  const run = runRepo.create({
    id: "run-attempt-loop",
    projectId: PROJECT_ID,
    projectName: "Attempt Loop Project",
    ticket: { id: "AL-1", title: "Attempt loop", acceptanceCriteria: [] },
    plan: "1. Update app",
    branch: "main",
    status: "executing",
    artifactsDir,
    worktreePath: repo,
  });
  jobRepo.createJob({ runId: run.id, stage: "execute", status: "pending" });
  const executor = new ExecuteExecutor({
    loadSettings: async () => settings,
    reviewExecutor,
  });
  const worker = new Worker({
    workerId: "worker-attempt-loop",
    db,
    getStageExecutor: () => executor,
  });
  return { db, runRepo, jobRepo, commandRepo, eventRepo, run, worker };
}

async function lines(file: string): Promise<string[]> {
  try {
    return (await readFile(file, "utf-8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 8000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for condition");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-attempt-loop-"));
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
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  await execStrict("git", ["init", "--initial-branch=main", repo], {
    envPolicy: "inherit",
  });
  await git("config", "user.email", "test@xfactory.dev");
  await git("config", "user.name", "X-Factory Test");
  await write("README.md", "# Fixture\n");
  await write("src/app.ts", "export const app = 1;\n");
});

async function commitAndRecordBaseline(): Promise<void> {
  await git("add", "-A");
  await git("commit", "-m", "Initial commit");
  await saveRecordedBaseline(
    baselinePathFor(artifactsDir),
    await recordBaseline(repo),
  );
}

afterEach(async () => {
  process.env.PATH = originalPath;
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("Attempt loop at the Worker seam", () => {
  it("runs X-Factory's own loop script even when the repository ships a ralph.sh", async () => {
    const marker = path.join(tempDir, "repo-ralph-ran");
    await write("ralph.sh", `#!/usr/bin/env bash\ntouch "${marker}"\nexit 1\n`);
    await chmod(path.join(repo, "ralph.sh"), 0o755);
    await commitAndRecordBaseline();
    await installSbx(
      `${CHECK_OFF_FIRST_TASK}\necho "export const updated = true;" > src/app.ts`,
    );
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("awaiting_review");
    expect(runRepo.get(run.id)?.verification?.filesChanged).toEqual([
      "src/app.ts",
    ]);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(await readFile(path.join(repo, "ralph.sh"), "utf-8")).toBe(
      `#!/usr/bin/env bash\ntouch "${marker}"\nexit 1\n`,
    );
  });

  it("the prompt file the loop receives contains the run's understanding context", async () => {
    await commitAndRecordBaseline();
    await installSbx(
      `${CHECK_OFF_FIRST_TASK}\necho "export const updated = true;" > src/app.ts`,
    );
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup();

    // The understand stage's output, persisted on the run exactly as UnderstandExecutor stores it.
    runRepo.update(run.id, {
      implementationContext: {
        relevantFiles: ["src/auth.ts"],
        architecturalNotes: "Token verification lives in src/auth.ts.",
        existingBehavior: "Login returns a cookie named xf_session.",
        constraints: ['Test command must pass: "true"'],
        risks: ["Editing src/cache.ts breaks session invalidation"],
      },
      expectedRevision: run.revision,
    });

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("awaiting_review");
    const prompt = await readFile(
      path.join(repo, ".agent", "PROMPT.md"),
      "utf-8",
    );
    expect(prompt).toContain("## Codebase Understanding");
    expect(prompt).toContain("Relevant files: src/auth.ts");
    expect(prompt).toContain("Token verification lives in src/auth.ts.");
    expect(prompt).toContain("Login returns a cookie named xf_session.");
    expect(prompt).toContain(
      "- Editing src/cache.ts breaks session invalidation",
    );
  });

  it("spends the repair budget: every attempt re-runs the agent on a fresh unchecked task", async () => {
    await commitAndRecordBaseline();
    const log = path.join(tempDir, "sbx.log");
    // Logs "<unchecked tasks> <first prompt line>" before the agent works; the third attempt writes the passing value.
    await installSbx(`
n=$(( $(wc -l < "${log}" 2>/dev/null || echo 0) + 1 ))
echo "$(grep -c '\\[ \\]' .agent/tasks.md) $(head -n 1 .agent/PROMPT.md)" >> "${log}"
echo "export const v = $n;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    await configureProject(`grep -q "v = 3" src/app.ts`);
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    const finished = runRepo.get(run.id);
    expect(finished?.status).toBe("awaiting_review");
    expect(finished?.verification?.passed).toBe(true);
    expect(finished?.verification?.repairAttempt).toBe(3);
    expect(await lines(log)).toEqual([
      "1 # Ralph Loop Task Execution Protocol (Matt Pocock TDD Protocol)",
      "1 Deterministic verification checks failed on attempt 1 of 3.",
      "1 Deterministic verification checks failed on attempt 2 of 3.",
    ]);
  });

  it("stops at the single attempt cap when verification never passes", async () => {
    await commitAndRecordBaseline();
    const log = path.join(tempDir, "sbx.log");
    await installSbx(`
echo run >> "${log}"
echo "export const updated = true;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    await configureProject("false");
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(await lines(log)).toEqual(["run", "run", "run"]);
    expect(runRepo.get(run.id)?.verification?.repairAttempt).toBe(3);
    expect(jobRepo.getJob(claimed.id)?.error).toContain(
      "Verification did not pass after bounded repairs",
    );
  });

  it("gives the loop the implementation session's credentials only", async () => {
    await commitAndRecordBaseline();
    const envFile = path.join(tempDir, "sbx-env.txt");
    process.env.OPENAI_API_KEY = "sk-session-a-openai";
    process.env.GEMINI_API_KEY = "sk-session-b-gemini";
    process.env.ANTHROPIC_API_KEY = "sk-unrelated-anthropic";
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
    process.env.HTTP_PROXY = "http://proxy:8080";
    process.env.PI_API_KEY = "pi-key-passthrough";
    await installSbx(`
{ echo "openai=\${OPENAI_API_KEY:-}"; echo "gemini=\${GEMINI_API_KEY:-}"; echo "anthropic=\${ANTHROPIC_API_KEY:-}"; echo "aws=\${AWS_SECRET_ACCESS_KEY:-}"; echo "proxy=\${HTTP_PROXY:-}"; echo "pi=\${PI_API_KEY:-}"; } > "${envFile}"
echo "export const updated = true;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    await configureProject("true");
    const { jobRepo, worker } = setup({
      models: {
        sessionA: { provider: "openai", model: "gpt-x" },
        sessionB: { provider: "google", model: "gemini-x" },
      },
    } as Settings);

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(await lines(envFile)).toEqual([
      "openai=sk-session-a-openai",
      "gemini=",
      "anthropic=",
      "aws=",
      "proxy=",
      "pi=pi-key-passthrough",
    ]);
  });

  it("fails closed when preparation recorded no baseline", async () => {
    await git("add", "-A");
    await git("commit", "-m", "Initial commit");
    await installSbx("exit 0");
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.verification).toBeNull();
    expect(jobRepo.getJob(claimed.id)?.error).toContain(
      "no baseline was recorded during preparation",
    );
  });

  it("writes the workspace scaffold, streams loop events, and persists verification before review starts", async () => {
    await commitAndRecordBaseline();
    await installSbx(`
echo "Iteration 1: Working on Task 1"
echo "export const updated = true;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    await configureProject("true");
    const seenByReview: {
      diff?: string | null | undefined;
      passed?: boolean | undefined;
    } = {};
    const reviewHolder: { runRepo?: RunRepository } = {};
    const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);
    const review = new ReviewExecutor({
      loadSettings: async () => ({}),
      sessionFactory: async () => {
        const persisted = reviewHolder.runRepo?.get("run-attempt-loop");
        seenByReview.diff = persisted?.diff;
        seenByReview.passed = persisted?.verification?.passed;
        return session;
      },
    });
    const { run, runRepo, jobRepo, eventRepo, worker } = setup({}, review);
    reviewHolder.runRepo = runRepo;

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    const finished = runRepo.get(run.id);
    expect(finished?.status).toBe("awaiting_review");
    expect(finished?.review?.passed).toBe(true);
    expect(seenByReview.passed).toBe(true);
    expect(seenByReview.diff).toContain("+export const updated = true;");
    expect(finished?.diff).not.toContain(".agent/");
    expect(finished?.diff).not.toContain("ralph.sh");

    expect(await readFile(path.join(repo, ".agent", "tasks.md"), "utf-8")).toBe(
      "# Task List\n\n## Task 1: Update app\n- [x] Task 1: Update app\n",
    );
    expect(
      await readFile(path.join(repo, ".agent", "PROMPT.md"), "utf-8"),
    ).toContain("Matt Pocock TDD Protocol");

    const events = eventRepo.getEventsForRun(run.id);
    const progress = events
      .filter((e) => e.type === "ralph_progress")
      .map((e) => (e.payload as { text: string }).text);
    expect(progress).toContain("Ralph Loop started with 25 iterations");
    expect(progress).toContain("Iteration 1: Working on Task 1");
    expect(events.filter((e) => e.type === "verification")).toHaveLength(1);
    expect(
      events.some(
        (e) =>
          e.type === "pi_output_chunk" &&
          JSON.stringify(e.payload).includes("Working on Task 1"),
      ),
    ).toBe(true);
  });

  it("emits one verification event per attempt while repairing", async () => {
    await commitAndRecordBaseline();
    const log = path.join(tempDir, "sbx.log");
    await installSbx(`
echo run >> "${log}"
n=$(( $(wc -l < "${log}") ))
echo "export const v = $n;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    await configureProject(`grep -q "v = 2" src/app.ts`);
    const { run, runRepo, jobRepo, eventRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("awaiting_review");
    const attempts = eventRepo
      .getEventsForRun(run.id)
      .filter((e) => e.type === "verification")
      .map(
        (e) =>
          (e.payload as { result: { passed: boolean; repairAttempt: number } })
            .result,
      )
      .map((r) => [r.repairAttempt, r.passed]);
    expect(attempts).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("reports a loop crash with its exit code and stderr, and runs no verification", async () => {
    await commitAndRecordBaseline();
    await installSbx(
      `echo "Docker sandbox crashed: out of memory" >&2\nexit 137`,
    );
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(jobRepo.getJob(claimed.id)?.error).toContain(
      "Ralph Loop exited with code 137: Docker sandbox crashed: out of memory",
    );
    expect(runRepo.get(run.id)?.verification).toBeNull();
  });

  it("does not request awaiting_review when the review fails", async () => {
    await commitAndRecordBaseline();
    await installSbx(
      `${CHECK_OFF_FIRST_TASK}\necho "export const updated = true;" > src/app.ts`,
    );
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup(
      {},
      {
        stage: "review",
        execute: async () => ({ outcome: "error", error: "Review failed" }),
      },
    );

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(jobRepo.getJob(claimed.id)?.error).toBe("Review failed");
    expect(runRepo.get(run.id)?.status).toBe("executing");
  });

  it("reports a scaffold failure as a loop execution failure", async () => {
    await write(
      ".agent",
      "a regular file where the workspace directory must be\n",
    );
    await commitAndRecordBaseline();
    await installSbx("exit 0");
    await configureProject("true");
    const { run, runRepo, jobRepo, worker } = setup();

    const claimed = jobRepo.claimNextJob("worker-attempt-loop", 30_000);
    if (!claimed) throw new Error("Expected a claimed job");
    await worker.processJob(claimed);

    expect(jobRepo.getJob(claimed.id)?.error).toContain(
      "Ralph Loop execution failed:",
    );
    expect(runRepo.get(run.id)?.verification).toBeNull();
  });

  it("kills a loop that exceeds its timeout and reports it as timed out", async () => {
    await commitAndRecordBaseline();
    const pidFile = path.join(tempDir, "slow-agent.pid");
    await installSbx(`echo $$ > "${pidFile}"\nsleep 60`);
    await write(".agent/tasks.md", "- [ ] t\n");
    let agentPid = 0;
    try {
      const result = await runAttemptLoop({
        worktreePath: repo,
        artifactsDir,
        ticket: { id: "AL-2", title: "Slow", acceptanceCriteria: [] },
        plan: "1. Slow",
        project: {
          id: PROJECT_ID,
          name: "Attempt Loop Project",
          workspacePath: repo,
          repositoryPath: repo,
          defaultBranch: "main",
          testCommand: "true",
          repositories: [],
          issueTracker: { provider: "jira" },
        } satisfies Project,
        baseline: await recordBaseline(repo),
        provider: "anthropic",
        timeoutMs: 400,
        emit: () => {},
        onVerification: () => {},
      });

      expect(result).toEqual({
        outcome: "failed",
        error: "Ralph Loop execution timed out after 400ms",
      });
      agentPid = Number.parseInt((await lines(pidFile))[0] ?? "", 10);
      expect(await waitDead(agentPid)).toBe(true);
    } finally {
      if (agentPid > 0 && isAlive(agentPid)) process.kill(agentPid, "SIGKILL");
    }
  });

  it("a run stop during verification ends the run promptly and starts no new loop", async () => {
    await commitAndRecordBaseline();
    const log = path.join(tempDir, "sbx.log");
    const pidFile = path.join(tempDir, "verify-child.pid");
    await installSbx(`
echo run >> "${log}"
echo "export const updated = true;" > src/app.ts
${CHECK_OFF_FIRST_TASK}
`);
    // Verification hangs on a background child until the stop arrives.
    await configureProject(`sh -c 'sleep 60 & echo $! > "${pidFile}"; wait'`);
    const { run, runRepo, jobRepo, commandRepo, eventRepo, db, worker } =
      setup();

    const started = Date.now();
    const processing = worker.stepRun(run.id);
    let verifyChild = 0;
    try {
      verifyChild = await waitFor(async () => {
        const pid = Number.parseInt((await lines(pidFile))[0] ?? "", 10);
        return pid > 0 ? pid : undefined;
      });

      await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });
      await worker.stepCommandOnce();
      await processing;

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(runRepo.get(run.id)?.status).toBe("stopped");
      expect(await lines(log)).toEqual(["run"]);
      expect(await waitDead(verifyChild)).toBe(true);
    } finally {
      await worker.stop();
      await processing.catch(() => {});
      if (verifyChild > 0 && isAlive(verifyChild)) {
        process.kill(verifyChild, "SIGKILL");
      }
    }
  });

  it("a run stop during the loop kills the loop's whole process group", async () => {
    await commitAndRecordBaseline();
    const pidFile = path.join(tempDir, "agent.pid");
    await installSbx(`echo $$ > "${pidFile}"\nsleep 60`);
    await configureProject("true");
    const { run, runRepo, jobRepo, commandRepo, eventRepo, db, worker } =
      setup();

    const processing = worker.stepRun(run.id);
    let agentPid = 0;
    try {
      agentPid = await waitFor(async () => {
        const pid = Number.parseInt((await lines(pidFile))[0] ?? "", 10);
        return pid > 0 ? pid : undefined;
      });

      await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });
      await worker.stepCommandOnce();
      await processing;

      expect(runRepo.get(run.id)?.status).toBe("stopped");
      expect(await waitDead(agentPid)).toBe(true);
    } finally {
      await worker.stop();
      await processing.catch(() => {});
      if (agentPid > 0 && isAlive(agentPid)) process.kill(agentPid, "SIGKILL");
    }
  });
});
