// test/lease-settle-failure-log.test.ts — a job the sweep cannot settle is logged
// once per (job id, error) per process, not once per poll tick (#163).

import { describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { LeaseManager, type LeaseStructuredLogEntry } from "../src/lease.js";

const PAST = "2020-01-01T00:00:00.000Z";
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function setupTest() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  return { db, repos };
}

/** A run in `executing` with one claimed job whose lease expired and budget is spent. */
function createStaleExhaustedJob(
  repos: Repositories,
  runId: string,
): { runId: string; jobId: string } {
  const run = repos.runs.create({
    id: runId,
    projectId: `proj-${runId}`,
    projectName: `Project ${runId}`,
    ticket: { id: `T-${runId}`, title: "Poisoned", acceptanceCriteria: [] },
    plan: "Plan",
    branch: `factory/${runId}`,
    status: "executing",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });
  const job = repos.jobs.createJob({
    runId: run.id,
    stage: "execute",
    status: "pending",
    maxAttempts: 1,
  });
  repos.db
    .prepare(
      `UPDATE jobs
         SET status = 'claimed', worker_id = 'dead-worker',
             lease_until = ?, attempts = 1
       WHERE id = ?;`,
    )
    .run(PAST, job.id);
  return { runId: run.id, jobId: job.id };
}

/** Makes `transitionRun` fail for exactly one run, as a poisoned run would. */
function poisonRunTransition(repos: Repositories, poisonedRunId: string): void {
  const original = repos.runs.transitionRun.bind(repos.runs);
  repos.runs.transitionRun = ((
    ...args: Parameters<typeof repos.runs.transitionRun>
  ) => {
    if (args[0] === poisonedRunId) {
      throw new Error("run transition exploded");
    }
    return original(...args);
  }) as typeof repos.runs.transitionRun;
}

describe("lease settle-failure logging (#163)", () => {
  it("logs a job whose run transition keeps throwing once across many ticks, and still settles the next job", () => {
    const { repos } = setupTest();
    const poisoned = createStaleExhaustedJob(repos, "run-poisoned");
    const healthy = createStaleExhaustedJob(repos, "run-healthy");
    poisonRunTransition(repos, poisoned.runId);

    const logs: LeaseStructuredLogEntry[] = [];
    const lease = new LeaseManager(repos, {
      clock: { now: () => NOW },
      onLog: (entry) => logs.push(entry),
    });

    // Ten poll ticks: the broken job rolls back every time.
    for (let tick = 0; tick < 10; tick += 1) {
      lease.expireJobs();
    }

    const poisonedLogs = logs.filter(
      (entry) => entry.job_id === poisoned.jobId && entry.result === "error",
    );
    expect(poisonedLogs.length).toBe(1);
    expect(poisonedLogs[0]?.error).toBe("run transition exploded");
    expect(poisonedLogs[0]?.message).toBe(
      `Could not settle stale job ${poisoned.jobId} for run ${poisoned.runId}.`,
    );

    // The failure stayed isolated: the other exhausted job was settled.
    expect(repos.jobs.getJob(healthy.jobId)?.status).toBe("failed");
    expect(repos.runs.get(healthy.runId)?.status).toBe("recovery_required");
    // The poisoned job's transaction rolled back, so it is retried later.
    expect(repos.jobs.getJob(poisoned.jobId)?.status).toBe("claimed");
  });

  it("logs an exhausted pending job that keeps failing once across many ticks", () => {
    const { repos } = setupTest();
    const poisoned = createStaleExhaustedJob(repos, "run-pending-poisoned");
    // Back to pending with its budget spent: the sweep settles it before claiming.
    repos.db
      .prepare(
        `UPDATE jobs SET status = 'pending', worker_id = NULL, lease_until = NULL
           WHERE id = ?;`,
      )
      .run(poisoned.jobId);
    poisonRunTransition(repos, poisoned.runId);

    const logs: LeaseStructuredLogEntry[] = [];
    const lease = new LeaseManager(repos, {
      clock: { now: () => NOW },
      onLog: (entry) => logs.push(entry),
    });

    for (let tick = 0; tick < 6; tick += 1) {
      lease.expireJobs();
    }

    const poisonedLogs = logs.filter(
      (entry) => entry.job_id === poisoned.jobId && entry.result === "error",
    );
    expect(poisonedLogs.length).toBe(1);
    expect(poisonedLogs[0]?.message).toBe(
      `Could not settle exhausted pending job ${poisoned.jobId} for run ${poisoned.runId}.`,
    );
  });
});
