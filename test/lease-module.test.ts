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

  describe("review fixes", () => {
    function seedExhaustedClaim(
      db: ReturnType<typeof setupTest>["db"],
      repos: Repositories,
      runId: string,
      leaseUntilMs: number,
    ) {
      const job = repos.jobs.createJob({
        runId,
        stage: "execute",
        status: "pending",
        maxAttempts: 3,
      });
      db.prepare(`
        UPDATE jobs
        SET status = 'claimed', worker_id = 'crashed-worker',
            lease_until = $leaseUntil, attempts = 3
        WHERE id = $id;
      `).run({
        $leaseUntil: new Date(leaseUntilMs).toISOString(),
        $id: job.id,
      });
      const attempt = repos.stageAttempts.recordStart(runId, "execute", 3);
      return { job, attempt };
    }

    function blockRunTransitions(db: ReturnType<typeof setupTest>["db"]) {
      db.exec(`
        CREATE TRIGGER block_run_update BEFORE UPDATE ON runs
        BEGIN SELECT RAISE(ABORT, 'run update blocked'); END;
      `);
    }

    it("exhausting a job is atomic: a failed run transition leaves the job, attempt and run untouched", async () => {
      const { db, repos } = setupTest();
      const runId = "run-exhaust-atomic";
      createExecutingRun(repos, runId);
      let currentTime = Date.parse("2020-01-01T00:00:00.000Z");
      const clock = { now: () => currentTime };
      const { job, attempt } = seedExhaustedClaim(
        db,
        repos,
        runId,
        currentTime + 30_000,
      );
      currentTime += 35_000;

      blockRunTransitions(db);
      const logs: Array<{ result: string; error?: string | undefined }> = [];
      const worker = new Worker({
        db,
        workerId: "live-worker",
        clock,
        onLog: (entry) => logs.push(entry),
      });
      // The failure is isolated and logged; it does not abort the claim sweep.
      await worker.stepOnce();
      expect(
        logs.some(
          (l) =>
            l.result === "error" && l.error?.includes("run update blocked"),
        ),
      ).toBe(true);
      expect(repos.jobs.getJob(job.id)?.status).toBe("claimed");
      expect(repos.stageAttempts.getLatestAttempt(runId, "execute")?.id).toBe(
        attempt.id,
      );
      expect(
        repos.stageAttempts.getLatestAttempt(runId, "execute")?.status,
      ).toBe("running");
      expect(repos.runs.get(runId)?.status).toBe("executing");

      // Once the fault clears, the same sweep completes all three changes.
      db.exec("DROP TRIGGER block_run_update;");
      await worker.stepOnce();
      expect(repos.jobs.getJob(job.id)?.status).toBe("failed");
      expect(repos.runs.get(runId)?.status).toBe("recovery_required");
      expect(
        repos.stageAttempts.getLatestAttempt(runId, "execute")?.status,
      ).toBe("failed");
    });

    it("startup recovery uses the same exhaust path, so a failed transition rolls back", async () => {
      const { db, repos } = setupTest();
      const runId = "run-startup-exhaust-atomic";
      createExecutingRun(repos, runId);
      const now = Date.parse("2020-06-01T00:00:00.000Z");
      const { job } = seedExhaustedClaim(db, repos, runId, now - 5_000);

      blockRunTransitions(db);
      const worker = new Worker({
        db,
        workerId: "startup",
        clock: { now: () => now },
      });
      const first = await worker.recoverOnStartup();
      expect(first).toEqual({ recoveredJobs: 0, recoveryRequiredRuns: 0 });
      expect(repos.jobs.getJob(job.id)?.status).toBe("claimed");
      expect(repos.runs.get(runId)?.status).toBe("executing");

      db.exec("DROP TRIGGER block_run_update;");
      const recovery = await worker.recoverOnStartup();
      expect(recovery.recoveryRequiredRuns).toBe(1);
      expect(repos.runs.get(runId)?.status).toBe("recovery_required");
      expect(repos.jobs.getJob(job.id)?.status).toBe("failed");
    });

    it("exhaust and command expiry each live in one place in src", async () => {
      const { Glob } = await import("bun");
      const { readFileSync } = await import("node:fs");
      const files = Array.from(new Glob("src/**/*.ts").scanSync("."));
      const count = (needle: string) =>
        files.filter((f) => readFileSync(f, "utf8").includes(needle));
      expect(count("Command lease expired; retries exhausted")).toHaveLength(1);
      expect(
        count("Maximum retry attempts exhausted across worker lifetimes"),
      ).toHaveLength(1);
      expect(count("Job attempts (")).toHaveLength(1);
    });

    it("no lease or heartbeat duration is spelled outside src/lease.ts", async () => {
      const { Glob } = await import("bun");
      const { readFileSync } = await import("node:fs");
      // Evaluates `30000`, `30_000`, `30 * 1000`, `5 * 60 * 1000` and so on.
      const products = (line: string): number[] =>
        Array.from(line.matchAll(/\b\d[\d_]*(?:\s*\*\s*\d[\d_]*)*/g), (m) =>
          m[0]
            .split("*")
            .map((n) => Number(n.replaceAll("_", "").trim()))
            .reduce((a, b) => a * b, 1),
        );
      const policyValues = new Set([10_000, 30_000, 60_000, 100_000, 300_000]);
      const leaseFiles = new Set([
        "src/worker.ts",
        "src/server.ts",
        "src/http/diagnostics-controller.ts",
        ...new Glob("src/db/**/*.ts").scanSync("."),
        ...new Glob("src/diagnostics/**/*.ts").scanSync("."),
      ]);
      // A TTL of something else (project-creation claims) is not a lease.
      const unrelated = new Set(["src/services/creation-claim.ts"]);
      const offenders: string[] = [];
      const all = [...new Glob("src/**/*.{ts,tsx}").scanSync(".")].filter(
        (f) => f !== "src/lease.ts" && !unrelated.has(f),
      );
      for (const f of all) {
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "");
            const values = products(code);
            const leaseWords = /lease|heartbeat|ttl/i.test(code);
            if (
              (leaseFiles.has(f) && values.some((v) => policyValues.has(v))) ||
              (leaseWords && values.some((v) => v >= 1000))
            ) {
              offenders.push(`${f}:${i + 1}: ${line.trim()}`);
            }
          });
      }
      expect(offenders).toEqual([]);
    });

    it("a lease renewed between the stale read and the exhaust is left alone", async () => {
      const { LeaseManager } = await import("../src/lease.js");
      const { db, repos } = setupTest();
      const runId = "run-renewed-race";
      createExecutingRun(repos, runId);
      const now = Date.parse("2020-01-01T00:00:00.000Z");
      const { job } = seedExhaustedClaim(db, repos, runId, now - 5_000);

      // Another worker renews the lease right after this one read the stale list.
      const realFind = repos.jobs.findStaleClaimedJobs.bind(repos.jobs);
      repos.jobs.findStaleClaimedJobs = (...args) => {
        const found = realFind(...args);
        db.prepare("UPDATE jobs SET lease_until = $l WHERE id = $id").run({
          $l: new Date(now + 30_000).toISOString(),
          $id: job.id,
        });
        return found;
      };
      const lease = new LeaseManager(repos, { clock: { now: () => now } });
      const result = lease.recoverStaleJobs();

      expect(result).toEqual({
        expiredCount: 0,
        recoveryRequiredCount: 0,
        recoveredCount: 0,
      });
      expect(repos.jobs.getJob(job.id)?.status).toBe("claimed");
      expect(repos.runs.get(runId)?.status).toBe("executing");
      expect(
        repos.stageAttempts.getLatestAttempt(runId, "execute")?.status,
      ).toBe("running");
    });

    it("one job whose run transition keeps failing does not stop another job being claimed", async () => {
      const { db, repos } = setupTest();
      const t = Date.parse("2020-01-01T00:00:00.000Z");
      const clock = { now: () => t + 60_000 };
      createExecutingRun(repos, "run-poison");
      createExecutingRun(repos, "run-good");
      const { job: poisoned } = seedExhaustedClaim(db, repos, "run-poison", t);
      const good = repos.jobs.createJob({
        runId: "run-good",
        stage: "execute",
        availableAt: new Date(t).toISOString(),
      });
      db.exec(`
        CREATE TRIGGER poison_run BEFORE UPDATE ON runs WHEN OLD.id = 'run-poison'
        BEGIN SELECT RAISE(ABORT, 'poisoned run'); END;
      `);
      const logs: Array<{ result: string; job_id?: string | undefined }> = [];
      const worker = new Worker({
        db,
        workerId: "w",
        clock,
        onLog: (e) => logs.push(e),
        getStageExecutor: () => ({
          stage: "execute",
          execute: async () => ({ outcome: "passed", output: {} }),
        }),
      });
      const stepped = await worker.stepOnce();
      expect(stepped?.id).toBe(good.id);
      expect(repos.jobs.getJob(poisoned.id)?.status).toBe("claimed");
      expect(
        logs.filter((l) => l.result === "error" && l.job_id === poisoned.id),
      ).toHaveLength(1);
    });

    it("startup recovery fails, without touching the run, a stale job whose run is terminal", async () => {
      const { db, repos } = setupTest();
      const t = Date.parse("2020-01-01T00:00:00.000Z");
      const run = createExecutingRun(repos, "run-terminal");
      repos.runs.transitionRun(run.id, "executing", "failed");
      const before = repos.runs.get("run-terminal");
      const job = repos.jobs.createJob({
        runId: "run-terminal",
        stage: "execute",
        availableAt: new Date(t).toISOString(),
      });
      db.prepare(
        "UPDATE jobs SET status='claimed', worker_id='dead', lease_until=$l, attempts=1 WHERE id=$id",
      ).run({ $l: new Date(t - 1_000).toISOString(), $id: job.id });
      const attempt = repos.stageAttempts.recordStart(
        "run-terminal",
        "execute",
        1,
      );

      const worker = new Worker({ db, workerId: "w", clock: { now: () => t } });
      const recovery = await worker.recoverOnStartup();

      expect(recovery).toEqual({ recoveredJobs: 0, recoveryRequiredRuns: 0 });
      expect(repos.jobs.getJob(job.id)?.status).toBe("failed");
      expect(repos.runs.get("run-terminal")).toEqual(before);
      expect(
        repos.stageAttempts
          .listForRun("run-terminal")
          .find((a) => a.id === attempt.id)?.status,
      ).toBe("failed");
    });

    it("changing only the policy changes liveness and expiry decisions", async () => {
      const { LeaseManager } = await import("../src/lease.js");
      const { db, repos } = setupTest();
      createExecutingRun(repos, "run-policy");
      const t0 = Date.parse("2020-01-01T00:00:00.000Z");
      repos.jobs.createJob({
        runId: "run-policy",
        stage: "execute",
        availableAt: new Date(t0).toISOString(),
      });
      let now = t0;
      const short = new LeaseManager(repos, {
        clock: { now: () => now },
        policy: { jobLeaseTtlMs: 1_000, heartbeatTtlMs: 1_000 },
      });
      const claimed = short.claimNextJob("w1");
      expect(claimed?.leaseUntil).toBe(new Date(t0 + 1_000).toISOString());
      repos.heartbeats.upsert({
        workerId: "w1",
        pid: 1,
        hostname: "h",
        lastHeartbeat: new Date(t0).toISOString(),
      });
      now = t0 + 5_000;
      expect(short.isWorkerActive("w1")).toBe(false);
      const long = new LeaseManager(repos, {
        clock: { now: () => now },
        policy: { heartbeatTtlMs: 60_000 },
      });
      expect(long.isWorkerActive("w1")).toBe(true);
      expect(db).toBeDefined();
    });

    it("every decision follows the injected clock, even when real time disagrees", async () => {
      const { LeaseManager } = await import("../src/lease.js");
      const { db, repos } = setupTest();
      const fakeStart = Date.parse("2020-03-01T00:00:00.000Z");
      let fake = fakeStart;
      const clock = { now: () => fake };
      const iso = (ms: number) => new Date(ms).toISOString();
      const lease = new LeaseManager(repos, { clock });

      // Liveness: a heartbeat written at fake time is alive until fake time passes the TTL.
      repos.heartbeats.upsert({
        workerId: "peer",
        pid: 1,
        hostname: "h",
        lastHeartbeat: iso(fake),
      });
      expect(lease.isWorkerActive("peer")).toBe(true);
      expect(lease.isReady()).toBe(true);
      expect(lease.activeWorkers().map((w) => w.workerId)).toEqual(["peer"]);
      fake += 31_000;
      expect(lease.isWorkerActive("peer")).toBe(false);
      expect(lease.isReady()).toBe(false);

      // Release stamps updated_at with the fake clock.
      createExecutingRun(repos, "run-clock-release");
      repos.jobs.createJob({
        runId: "run-clock-release",
        stage: "execute",
        availableAt: iso(fake),
      });
      const claimed = lease.claimNextJob("w1");
      expect(claimed?.updatedAt).toBe(iso(fake));
      fake += 1_000;
      expect(lease.releaseJobLease(claimed?.id ?? "", "w1")).toBe(true);
      expect(repos.jobs.getJob(claimed?.id ?? "")?.updatedAt).toBe(iso(fake));

      // Startup recovery requeue and the exhaust transition use the fake clock.
      createExecutingRun(repos, "run-clock-requeue");
      createExecutingRun(repos, "run-clock-exhaust");
      const requeueJob = repos.jobs.createJob({
        runId: "run-clock-requeue",
        stage: "execute",
      });
      const exhaustJob = repos.jobs.createJob({
        runId: "run-clock-exhaust",
        stage: "execute",
      });
      db.prepare(
        `UPDATE jobs SET status='claimed', worker_id='dead', lease_until=$l, attempts=1 WHERE id=$id`,
      ).run({ $l: iso(fake - 1_000), $id: requeueJob.id });
      db.prepare(
        `UPDATE jobs SET status='claimed', worker_id='dead', lease_until=$l, attempts=3 WHERE id=$id`,
      ).run({ $l: iso(fake - 1_000), $id: exhaustJob.id });
      const worker = new Worker({ db, workerId: "recoverer", clock });
      await worker.recoverOnStartup();
      expect(repos.jobs.getJob(requeueJob.id)?.status).toBe("pending");
      expect(repos.jobs.getJob(requeueJob.id)?.updatedAt).toBe(iso(fake));
      expect(repos.jobs.getJob(exhaustJob.id)?.updatedAt).toBe(iso(fake));
      expect(repos.runs.get("run-clock-exhaust")?.updatedAt).toBe(iso(fake));
      const exhaustEvents = repos.events.getEventsForRun("run-clock-exhaust");
      expect(exhaustEvents.at(-1)?.createdAt).toBe(iso(fake));

      // Command completion stamps processed_at with the fake clock.
      createReadyForPrRun(repos, "run-clock-cmd");
      const cmd = repos.commands.insertOrRetryCommand({
        runId: "run-clock-cmd",
        command: "stop",
      });
      await worker.stepCommandOnce();
      expect(repos.commands.getCommand(cmd.id)?.status).toBe("completed");
      expect(repos.commands.getCommand(cmd.id)?.processedAt).toBe(iso(fake));
    });
  });
});
