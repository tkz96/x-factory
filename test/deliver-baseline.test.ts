// test/deliver-baseline.test.ts — Delivery commits against the baseline recorded at preparation (Worker seam, real temp git repo).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CommandRecord } from "../src/db/command-repository.js";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { DeliverExecutor } from "../src/executors/deliver.js";
import { execStrict } from "../src/proc.js";
import { Worker } from "../src/worker.js";
import {
  baselinePathFor,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";

let tempDir: string;
let repo: string;
let artifactsDir: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-deliver-baseline-"));
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  repo = path.join(tempDir, "repo");
  artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  await execStrict("git", ["init", "--initial-branch=main", repo]);
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    cwd: repo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    cwd: repo,
  });
  await writeFile(path.join(repo, "README.md"), "# Fixture\n");
  await execStrict("git", ["add", "-A"], { cwd: repo });
  await execStrict("git", ["commit", "-m", "Initial commit"], { cwd: repo });
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  await rm(tempDir, { recursive: true, force: true });
});

function setupWorker() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const runRepo = new RunRepository(db);
  const commandRepo = new CommandRepository(db);
  const run = runRepo.create({
    id: "run-baseline",
    projectId: "proj-baseline",
    projectName: "Baseline Project",
    ticket: { id: "B-1", title: "Add feature", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "main",
    status: "ready_for_pr",
    artifactsDir,
    worktreePath: repo,
  });
  const worker = new Worker({
    workerId: "worker-1",
    db,
    deliverExecutor: new DeliverExecutor({
      push: async () => {},
      createPullRequest: async () => "https://example.test/pr/1",
      findExistingPullRequest: async () => null,
    }),
  });
  return { runRepo, commandRepo, run, worker };
}

async function deliver(): Promise<{
  status: string | undefined;
  error: string | null | undefined;
}> {
  const { runRepo, commandRepo, run, worker } = setupWorker();
  commandRepo.insertOrRetryCommand({
    runId: run.id,
    command: "deliver",
    payload: {},
    idempotencyKey: `deliver:${run.id}`,
  });
  const [command] = commandRepo.claimPendingCommands("worker-1", 10_000);
  await worker.processCommand(command as CommandRecord);
  const failed = commandRepo.getCommand(command?.id ?? "");
  return { status: runRepo.get(run.id)?.status, error: failed?.error };
}

async function headFiles(): Promise<string[]> {
  const result = await execStrict(
    "git",
    ["show", "--name-only", "--format=", "HEAD"],
    { cwd: repo },
  );
  return result.stdout.split("\n").filter(Boolean).sort();
}

describe("Delivery baseline", () => {
  it("delivers using the baseline recorded at the run's baseline path", async () => {
    await saveRecordedBaseline(
      baselinePathFor(artifactsDir),
      await recordBaseline(repo),
    );
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "feature.ts"), "export {};\n");

    const outcome = await deliver();

    expect(outcome.status).toBe("pr_created");
    expect(await headFiles()).toEqual(["src/feature.ts"]);
  });

  it("fails closed without a recorded baseline instead of recording a new one", async () => {
    await writeFile(path.join(repo, "feature.ts"), "export {};\n");

    const outcome = await deliver();

    expect(outcome.status).toBe("ready_for_pr");
    expect(outcome.error).toMatch(/No usable baseline recorded/);
    expect(await headFiles()).toEqual(["README.md"]);
  });
});
