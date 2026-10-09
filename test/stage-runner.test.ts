// test/stage-runner.test.ts — The stage runner (#190) through the worker seam: one lifecycle
// for jobs and the deliver command, executors with a narrow context, output committed with
// the transition or not at all.

import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
} from "../src/executors/index.js";
import { PrepareExecutor } from "../src/executors/prepare.js";
import type { PullRequest } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import { deliveredOutcome } from "./helpers/deliver-outcome.js";

function setup(status: "preparing" | "understanding" | "ready_for_pr") {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  const run = repos.runs.create({
    id: "run-sr-1",
    projectId: "proj-sr",
    projectName: "Proj SR",
    ticket: { id: "T-1", title: "T1", acceptanceCriteria: [] },
    plan: "P",
    branch: "factory/T-1",
    status,
    artifactsDir: mkdtempSync(path.join(tmpdir(), "sr-artifacts-")),
    worktreePath: "/tmp/sr-worktree",
  });
  return { db, repos, run };
}

const PR: PullRequest = {
  url: "https://example.test/pr/1",
  branch: "factory/T-1",
  baseBranch: "main",
  title: "T1",
};

function stopMidStage(repos: Repositories, runId: string): void {
  repos.runs.transitionRun(runId, "preparing", "stopped", {
    event: { type: "status", payload: { status: "stopped", text: "stop" } },
  });
}

describe("stage runner", () => {
  it("does not persist the output of a stage whose run was stopped mid-stage", async () => {
    const { db, repos, run } = setup("preparing");
    repos.jobs.createJob({ runId: run.id, stage: "prepare" });

    const executor = new PrepareExecutor({
      branchExists: async () => true,
      worktreeExists: async () => false,
      createWorktree: async () => {
        stopMidStage(repos, run.id);
        return "/isolated/worktree/path";
      },
      recordBaseline: async () => ({
        trackedFiles: new Set<string>(),
        untrackedFiles: new Set<string>(),
      }),
      readFile: async () => {
        throw new Error("no baseline yet");
      },
      writeFile: async () => {},
    });
    const worker = new Worker({
      db,
      workerId: "worker-sr",
      getStageExecutor: () => executor,
    });

    await worker.stepOnce();

    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("stopped");
    expect(after?.worktreePath).toBe("/tmp/sr-worktree");
    const evidence = repos.events
      .getEventsForRun(run.id)
      .filter((e) => e.type === "stage_evidence");
    expect(evidence).toEqual([]);
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["cancelled"],
    );
  });

  it("gives executors only inputs, emit, ledger, signal and identity, never repositories", async () => {
    const jobSetup = setup("understanding");
    jobSetup.repos.jobs.createJob({
      runId: jobSetup.run.id,
      stage: "understand",
    });
    const seen: string[][] = [];
    const spy: StageExecutor = {
      stage: "spy",
      async execute(ctx: StageContext): Promise<StageOutcome> {
        seen.push(Object.keys(ctx).sort());
        return { outcome: "passed" };
      },
    };
    await new Worker({
      db: jobSetup.db,
      workerId: "worker-job",
      getStageExecutor: () => spy,
    }).stepOnce();

    const cmdSetup = setup("ready_for_pr");
    cmdSetup.repos.commands.insertOrRetryCommand({
      runId: cmdSetup.run.id,
      command: "deliver",
    });
    const deliverSpy: StageExecutor = {
      stage: "deliver",
      async execute(ctx: StageContext): Promise<StageOutcome> {
        seen.push(Object.keys(ctx).sort());
        return deliveredOutcome(PR);
      },
    };
    await new Worker({
      db: cmdSetup.db,
      workerId: "worker-cmd",
      deliverExecutor: deliverSpy,
    }).stepCommandOnce();

    const expected = [
      "attempt",
      "emit",
      "ledger",
      "project",
      "run",
      "signal",
      "stage",
      "workerId",
    ];
    expect(seen).toEqual([expected, expected]);
  });

  it("records the deliver stage attempt with the command's attempt number and finishes through the workflow route", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    // A worker that died holding the command: claimed once, lease long expired.
    repos.commands.claimPendingCommands("worker-dead", 10, 10, undefined, 1000);

    let attemptSeen = -1;
    const worker = new Worker({
      db,
      workerId: "worker-live",
      deliverExecutor: {
        stage: "deliver",
        async execute(ctx: StageContext): Promise<StageOutcome> {
          attemptSeen = ctx.attempt;
          return deliveredOutcome(PR);
        },
      },
    });
    await worker.stepCommandOnce();

    expect(attemptSeen).toBe(2);
    const attempts = repos.stageAttempts.listForRun(run.id);
    expect(attempts.map((a) => [a.stage, a.attempt, a.status])).toEqual([
      ["deliver", 2, "completed"],
    ]);
    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("pr_created");
    expect(after?.pullRequest?.url).toBe("https://example.test/pr/1");
    expect(repos.commands.getCommand(command.id)?.status).toBe("completed");
    const statusEvent = repos.events
      .getEventsForRun(run.id)
      .filter((e) => e.type === "status")
      .at(-1);
    const payload = statusEvent?.payload as { pullRequest: PullRequest };
    expect(payload.pullRequest.url).toBe("https://example.test/pr/1");
  });

  it("fails the deliver command when the executor returns something that is not an outcome", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    const worker = new Worker({
      db,
      workerId: "worker-duck",
      deliverExecutor: {
        stage: "deliver",
        // A bare PullRequest used to be accepted by shape; it is not an outcome.
        execute: (async () => PR) as never,
      },
    });
    await worker.stepCommandOnce();

    expect(repos.runs.get(run.id)?.status).toBe("ready_for_pr");
    const failed = repos.commands.getCommand(command.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("Stage deliver returned an invalid outcome");
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["failed"],
    );
  });

  it("fails the deliver command when a passed deliver recorded no pull request", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    const worker = new Worker({
      db,
      workerId: "worker-nopr",
      deliverExecutor: {
        stage: "deliver",
        execute: async () => ({ outcome: "passed" }),
      },
    });
    await worker.stepCommandOnce();

    expect(repos.runs.get(run.id)?.status).toBe("ready_for_pr");
    expect(repos.commands.getCommand(command.id)?.error).toBe(
      "Deliver passed without recording a pull request",
    );
  });
});
