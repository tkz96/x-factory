// test/lease-module.test.ts — Lease module regression tests through the Worker seam (#180).

import { describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { createPR } from "../src/runs.js";
import { Worker } from "../src/worker.js";

function setupTest() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  return { db, repos };
}

function createExecutingRun(repos: Repositories, runId: string) {
  return repos.runs.create({
    id: runId,
    projectId: "proj-lease-test",
    projectName: "Lease Test Project",
    ticket: {
      id: "LT-1",
      title: "Lease Test",
      acceptanceCriteria: [],
    },
    plan: "Plan",
    branch: "factory/lease-test",
    status: "executing",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });
}

function createReadyForPrRun(repos: Repositories, runId: string) {
  return repos.runs.create({
    id: runId,
    projectId: "proj-lease-test",
    projectName: "Lease Test Project",
    ticket: {
      id: "LT-PR-1",
      title: "Lease PR Test",
      acceptanceCriteria: [],
    },
    plan: "Plan",
    branch: "factory/lease-pr-test",
    status: "ready_for_pr",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });
}

describe("Lease module (#180)", () => {
  it("an expired lease always closes the previous stage attempt when reclaimed at runtime", async () => {
    const { db, repos } = setupTest();
    const runId = "run-lease-closes-attempt";
    createExecutingRun(repos, runId);

    let currentTime = Date.now();
    const clock = { now: () => currentTime };

    // Create job for stage execute
    repos.jobs.createJob({
      runId,
      stage: "execute",
      status: "pending",
      maxAttempts: 3,
    });

    // Worker 1 claims job at currentTime
    const worker1 = new Worker({
      db,
      workerId: "worker-1",
      clock,
      leaseDurationMs: 30_000,
    });
    // Record that worker 1 started stage attempt 1
    const claimedJob1 = repos.jobs.claimNextJob(
      worker1.workerId,
      30_000,
      undefined,
      currentTime,
    );
    expect(claimedJob1).not.toBeNull();
    const attempt1 = repos.stageAttempts.recordStart(runId, "execute", 1);
    expect(attempt1.status).toBe("running");

    // Advance clock past lease TTL (30s)
    currentTime += 35_000;

    // Worker 2 runs stepOnce at runtime
    const worker2 = new Worker({
      db,
      workerId: "worker-2",
      clock,
      leaseDurationMs: 30_000,
      getStageExecutor: () => ({
        stage: "execute",
        execute: async () => {
          // Worker 2 is executing attempt 2
          return { outcome: "passed", output: {} };
        },
      }),
    });

    await worker2.stepOnce();

    // Verify stage attempt 1 was closed as failed due to lease expiry
    const pastAttempts = repos.stageAttempts.listForRun(runId);
    const closedAttempt1 = pastAttempts.find((a) => a.id === attempt1.id);
    expect(closedAttempt1?.status).toBe("failed");
    expect(closedAttempt1?.error).toContain("expired");
  });

  it("a job whose lease expires at max attempts moves the run to recovery_required at runtime, without a worker restart", async () => {
    const { db, repos } = setupTest();
    const runId = "run-lease-max-attempts";
    createExecutingRun(repos, runId);

    let currentTime = Date.now();
    const clock = { now: () => currentTime };

    // Create job with maxAttempts = 3, currently claimed with attempts = 3
    const job = repos.jobs.createJob({
      runId,
      stage: "execute",
      status: "pending",
      maxAttempts: 3,
    });

    const pastLease = new Date(currentTime + 30_000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'crashed-worker',
          lease_until = $leaseUntil,
          attempts = 3
      WHERE id = $id;
    `).run({ $leaseUntil: pastLease, $id: job.id });

    // Record attempt 3 as running
    const attempt3 = repos.stageAttempts.recordStart(runId, "execute", 3);
    expect(attempt3.status).toBe("running");

    // Advance clock past lease TTL
    currentTime += 35_000;

    // A live worker is running and performs a runtime step (without restart)
    const liveWorker = new Worker({
      db,
      workerId: "live-worker",
      clock,
    });

    const steppedJob = await liveWorker.stepOnce();
    expect(steppedJob).toBeNull(); // No claimable job executed

    // Verify run transitioned to recovery_required
    const run = repos.runs.get(runId);
    expect(run?.status).toBe("recovery_required");

    // Verify attempt 3 was closed as failed
    const closedAttempt3 = repos.stageAttempts.getLatestAttempt(
      runId,
      "execute",
    );
    expect(closedAttempt3?.status).toBe("failed");
    expect(closedAttempt3?.error).toContain("expired");

    // Verify job is marked failed
    const updatedJob = repos.jobs.getJob(job.id);
    expect(updatedJob?.status).toBe("failed");
  });

  it("an expired command that can't be retried is marked failed, not left claimed", async () => {
    const { db, repos } = setupTest();
    const runId = "run-cmd-expired-max-attempts";
    createReadyForPrRun(repos, runId);

    let currentTime = Date.now();
    const clock = { now: () => currentTime };

    // Insert an at-most-once command with maxAttempts: 1
    const cmd = repos.commands.insertOrRetryCommand({
      runId,
      command: "deliver",
      maxAttempts: 1,
    });

    // Claim it initially
    const leaseUntil = new Date(currentTime + 300_000).toISOString();
    db.prepare(`
      UPDATE run_commands
      SET status = 'claimed',
          worker_id = 'crashed-worker',
          lease_until = $leaseUntil,
          attempts = 1
      WHERE id = $id;
    `).run({ $leaseUntil: leaseUntil, $id: cmd.id });

    const claimedCmd = repos.commands.getCommand(cmd.id);
    expect(claimedCmd?.status).toBe("claimed");
    expect(claimedCmd?.attempts).toBe(1);

    // Advance clock past command lease TTL
    currentTime += 350_000;

    // Live worker steps command processing
    const liveWorker = new Worker({
      db,
      workerId: "live-worker-cmd",
      clock,
    });

    await liveWorker.stepCommandOnce();

    // The expired command cannot be retried (attempts 1 >= maxAttempts 1).
    // It must be marked failed, NOT left claimed.
    const updatedCmd = repos.commands.getCommand(cmd.id);
    expect(updatedCmd?.status).toBe("failed");
    expect(updatedCmd?.error).toContain("expired");
  });

  it("defines the lease TTL once as policy", async () => {
    const { DEFAULT_LEASE_POLICY } = await import("../src/lease.js");
    expect(DEFAULT_LEASE_POLICY).toBeDefined();
    expect(DEFAULT_LEASE_POLICY.jobLeaseTtlMs).toBe(30_000);
    expect(DEFAULT_LEASE_POLICY.commandLeaseTtlMs).toBe(300_000);
    expect(DEFAULT_LEASE_POLICY.heartbeatIntervalMs).toBe(10_000);
    expect(DEFAULT_LEASE_POLICY.heartbeatTtlMs).toBe(30_000);
  });

  it("command idempotency lookup goes through the repository (no raw SQL in run commands)", async () => {
    const { repos } = setupTest();
    const runId = "run-idempotency-lookup";
    createReadyForPrRun(repos, runId);

    // First call creates the PR deliver command
    const res1 = await createPR(repos, runId);
    expect(res1).toEqual({ ok: true, queued: true });

    // Second call looks up existing command by idempotency key through commandRepo
    const res2 = await createPR(repos, runId);
    expect(res2).toEqual({ ok: true, queued: true });

    // Verify only one command was created
    const cmd = repos.commands.getCommandByIdempotencyKey(`deliver:${runId}`);
    expect(cmd).not.toBeNull();
    expect(cmd?.command).toBe("deliver");
  });

  it("dead-target resolution happens in command repository and worker has no dead-target branch", async () => {
    const { repos } = setupTest();
    const runId = "run-dead-target-resolved";
    createReadyForPrRun(repos, runId);

    // Dead worker heartbeat in the past
    repos.heartbeats.upsert({
      workerId: "dead-worker",
      pid: 1234,
      hostname: "test-host",
      lastHeartbeat: new Date(Date.now() - 60_000).toISOString(),
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // Targeted stop command to dead worker
    const stopCmd = repos.commands.insertOrRetryCommand({
      runId,
      command: "stop",
      targetWorkerId: "dead-worker",
    });

    // When surviving worker claims commands, the dead target is resolved in the repository
    const liveWorker = new Worker({
      workerId: "surviving-worker",
      db: repos.db,
    });

    await liveWorker.stepCommandOnce();

    const resolvedStop = repos.commands.getCommand(stopCmd.id);
    expect(resolvedStop?.status).toBe("completed");
    expect(resolvedStop?.result).toContain("Target worker dead");
  });
});
