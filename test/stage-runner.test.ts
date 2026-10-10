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
import { DeliverExecutor } from "../src/executors/deliver.js";
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

function stopMidStageFrom(
  repos: Repositories,
  runId: string,
  from: "ready_for_pr",
): void {
  repos.runs.transitionRun(runId, from, "stopped", {
    event: { type: "status", payload: { status: "stopped", text: "stop" } },
  });
}

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
    expect(repos.jobs.listJobsForRun(run.id).length).toBe(1);
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["cancelled"],
    );
  });

  it("records no pull request and does not reach pr_created when the run is stopped while deliver executes", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    const worker = new Worker({
      db,
      workerId: "worker-stop-deliver",
      deliverExecutor: {
        stage: "deliver",
        async execute(): Promise<StageOutcome> {
          repos.runs.transitionRun(run.id, "ready_for_pr", "stopped", {
            event: { type: "status", payload: { status: "stopped" } },
          });
          return deliveredOutcome(PR);
        },
      },
    });
    await worker.stepCommandOnce();

    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("stopped");
    expect(after?.pullRequest).toBeNull();
    expect(repos.commands.getCommand(command.id)?.status).toBe("failed");
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["cancelled"],
    );
  });

  it("aborts the in-flight deliver when the run is stopped under it (#163)", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    let abortedAfterMs: number | null = null;
    const startedAt = Date.now();
    const worker = new Worker({
      db,
      workerId: "worker-stop-inflight-deliver",
      deliverExecutor: {
        stage: "deliver",
        execute(ctx: StageContext): Promise<StageOutcome> {
          return new Promise((_, reject) => {
            ctx.signal.addEventListener("abort", () => {
              abortedAfterMs = Date.now() - startedAt;
              reject(new Error("aborted"));
            });
            // Never finishes on its own: only the abort ends it.
            setTimeout(() => reject(new Error("never aborted")), 4000);
          });
        },
      },
    });
    setTimeout(() => stopMidStageFrom(repos, run.id, "ready_for_pr"), 50);

    await worker.stepCommandOnce();

    expect(abortedAfterMs).not.toBeNull();
    expect(abortedAfterMs ?? Number.POSITIVE_INFINITY).toBeLessThan(2500);
    expect(repos.runs.get(run.id)?.status).toBe("stopped");
    expect(repos.commands.getCommand(command.id)?.status).toBe("failed");
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["cancelled"],
    );
  });

  it("opens no pull request when the run is stopped between push and create_pr (#163)", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    const command = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
    });
    let created = 0;
    const worker = new Worker({
      db,
      workerId: "worker-stop-before-pr",
      deliverExecutor: new DeliverExecutor({
        loadRecordedBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        safeCommitAll: async () => {},
        getHeadSha: async () => "sha-1",
        getHeadMessage: async () => "msg",
        getParentSha: async () => "sha-0",
        getRemoteBranchSha: async () => null,
        findCommitByMessageAndParent: async () => null,
        push: async () => {
          // The stop lands during the push; the runner notices it within its poll interval.
          stopMidStageFrom(repos, run.id, "ready_for_pr");
          await new Promise((r) => setTimeout(r, 800));
        },
        findExistingPullRequest: async () => null,
        createPullRequest: async () => {
          created++;
          return "https://example.test/pr/9";
        },
      }),
    });
    await worker.stepCommandOnce();

    expect(created).toBe(0);
    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("stopped");
    expect(after?.pullRequest).toBeNull();
    expect(repos.commands.getCommand(command.id)?.status).toBe("failed");
  });

  it("aborts the in-flight deliver when a stop command targets its run (#163)", async () => {
    const { db, repos, run } = setup("ready_for_pr");
    repos.commands.insertOrRetryCommand({ runId: run.id, command: "deliver" });
    const worker = new Worker({
      db,
      workerId: "worker-stop-cmd-deliver",
      deliverExecutor: {
        stage: "deliver",
        execute(ctx: StageContext): Promise<StageOutcome> {
          return new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () =>
              resolve({ outcome: "error", error: "aborted" }),
            );
            setTimeout(
              () => resolve({ outcome: "error", error: "never aborted" }),
              4000,
            );
          });
        },
      },
    });
    const delivering = worker.stepCommandOnce();
    // The deliver command is claimed first; hand the worker the stop while it runs.
    const stopCommand = repos.commands.insertOrRetryCommand({
      runId: run.id,
      command: "stop",
      payload: {},
      idempotencyKey: `stop:${run.id}`,
    });
    await new Promise((r) => setTimeout(r, 50));
    await worker.processCommand(stopCommand);
    await delivering;

    const attempts = repos.stageAttempts.listForRun(run.id);
    expect(attempts.map((a) => [a.status, a.error])).toEqual([
      ["failed", "aborted"],
    ]);
  });

  it("closes the attempt and commits nothing when the run status changes between the re-check and the commit", async () => {
    const { db, repos, run } = setup("understanding");
    repos.jobs.createJob({ runId: run.id, stage: "understand" });
    const worker = new Worker({
      db,
      workerId: "worker-shift",
      getStageExecutor: () => ({
        stage: "understand",
        async execute(): Promise<StageOutcome> {
          // A status change that is not "stopped", so the re-check passes and only the
          // commit's own status guard can catch it.
          db.run("UPDATE runs SET status = 'planning' WHERE id = ?", [run.id]);
          return { outcome: "passed" };
        },
      }),
    });
    await worker.stepOnce();

    expect(repos.runs.get(run.id)?.status).toBe("planning");
    expect(repos.jobs.listJobsForRun(run.id).length).toBe(1);
    expect(repos.stageAttempts.listForRun(run.id).map((a) => a.status)).toEqual(
      ["cancelled"],
    );
  });

  it("writes nothing for a failed stage whose lease was lost, and does not throw", async () => {
    const { db, repos, run } = setup("understanding");
    const job = repos.jobs.createJob({ runId: run.id, stage: "understand" });
    const worker = new Worker({
      db,
      workerId: "worker-lost-lease",
      getStageExecutor: () => ({
        stage: "understand",
        async execute(): Promise<StageOutcome> {
          // Another worker now owns the job.
          db.run(
            "UPDATE jobs SET worker_id = 'worker-other', lease_until = ? WHERE id = ?",
            [new Date(Date.now() + 60_000).toISOString(), job.id],
          );
          return {
            outcome: "error",
            error: "boom",
            record: {
              run: { diff: "leaked diff" },
              events: [{ type: "info", payload: { text: "leaked event" } }],
            },
          };
        },
      }),
    });

    await worker.stepOnce();

    const after = repos.runs.get(run.id);
    expect(after?.diff).toBeNull();
    expect(after?.status).toBe("understanding");
    expect(
      repos.events
        .getEventsForRun(run.id)
        .some((e) => JSON.stringify(e.payload).includes("leaked event")),
    ).toBe(false);
    const stillOther = repos.jobs.getJob(job.id);
    expect(stillOther?.status).toBe("claimed");
    expect(stillOther?.workerId).toBe("worker-other");
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
    repos.commands.claimPendingCommands("worker-dead", 10, 10, 1000);

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
