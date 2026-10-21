// test/run-waiting-for-worker.test.ts — The run read says whether its current job is
// waiting for a worker, so the run page never says "Writing code" for a job no worker has
// claimed (Finding 9). The API only reads SQLite; the worker is what runs the job.

import { describe, expect, it } from "bun:test";
import { getRun } from "../src/runs.js";
import { createTestRepositories } from "./helpers/composition.js";

const T0 = Date.parse("2026-09-20T12:00:00.000Z");

function setupRun(status: "executing" | "awaiting_plan_approval") {
  const repos = createTestRepositories();
  const run = repos.runs.create({
    id: `run-waiting-${status}`,
    projectId: "proj-waiting",
    projectName: "Waiting",
    ticket: { id: "W-1", title: "Waiting", acceptanceCriteria: [] },
    plan: "1. Change app",
    branch: "factory/w-1",
    status,
    artifactsDir: "/tmp/xf-waiting-artifacts",
    worktreePath: "/tmp/xf-waiting-worktree",
  });
  return { repos, run };
}

describe("run read: waiting for the worker", () => {
  it("says the run waits for a worker while its job is pending", () => {
    const { repos, run } = setupRun("executing");
    repos.jobs.createJob({ runId: run.id, stage: "execute", maxAttempts: 3 });

    expect(getRun(repos, run.id)?.waitingForWorker).toBe(true);
  });

  it("says the run does not wait once a worker holds the job's lease", () => {
    const { repos, run } = setupRun("executing");
    repos.jobs.createJob({ runId: run.id, stage: "execute", maxAttempts: 3 });
    repos.jobs.claimNextJob("worker-live", 60 * 60_000);

    expect(getRun(repos, run.id)?.waitingForWorker).toBe(false);
  });

  it("says the run waits again once the claimed job's lease has run out", () => {
    const { repos, run } = setupRun("executing");
    repos.jobs.createJob({ runId: run.id, stage: "execute", maxAttempts: 3 });
    // A lease from 2026 has long run out, so the job is claimable again.
    repos.jobs.claimNextJob("worker-gone", 30_000, T0);

    expect(getRun(repos, run.id)?.waitingForWorker).toBe(true);
  });

  it("says the run does not wait when it has no active job (it waits on the reader)", () => {
    const { repos, run } = setupRun("awaiting_plan_approval");

    expect(getRun(repos, run.id)?.waitingForWorker).toBe(false);
  });
});
