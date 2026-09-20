// test/concurrent-workers.test.ts — Concurrent worker multi-processing and atomic claim exclusion (XFM-63).

import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type {
  StageContext,
  StageExecutor,
  StageResult,
} from "../src/executors/index.js";
import { Worker } from "../src/worker.js";

describe("Concurrent Worker Multi-Processing & Atomic Claim Exclusion (XFM-63)", () => {
  const testDbPath = path.resolve(
    process.cwd(),
    `.test-concurrent-${Date.now()}.db`,
  );

  afterAll(() => {
    try {
      rmSync(testDbPath, { force: true });
      rmSync(`${testDbPath}-wal`, { force: true });
      rmSync(`${testDbPath}-shm`, { force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("ensures two workers never claim the same job concurrently and process all jobs without duplicate execution", async () => {
    // Shared WAL-mode SQLite database for true multi-connection concurrency
    const db1 = createDatabase({ path: testDbPath });
    runMigrations(db1);

    const db2 = createDatabase({ path: testDbPath });

    const runRepo = new RunRepository(db1);
    const jobRepo1 = new JobRepository(db1);

    const totalRuns = 10;
    const runIds: string[] = [];
    const jobIds: string[] = [];

    // Create 10 runs with 1 job each
    for (let i = 0; i < totalRuns; i++) {
      const runId = `run-concurrent-${i}`;
      runIds.push(runId);
      runRepo.create({
        id: runId,
        projectId: "proj-concurrent",
        projectName: "Concurrent Project",
        ticket: {
          id: `CONC-${i}`,
          title: `Concurrent Ticket ${i}`,
          acceptanceCriteria: [],
        },
        plan: "Plan",
        branch: `factory/conc-${i}`,
        status: "preparing",
        artifactsDir: `/tmp/artifacts-conc-${i}`,
        worktreePath: `/tmp/worktrees-conc-${i}`,
      });

      const job = jobRepo1.createJob({
        runId,
        stage: "prepare",
        status: "pending",
      });
      jobIds.push(job.id);
    }

    // Track which worker processed which job
    const jobWorkerMapping = new Map<string, string>();
    const processingCollisions: string[] = [];

    const createSharedExecutor = (workerName: string): StageExecutor => ({
      stage: "prepare",
      async execute(ctx: StageContext): Promise<StageResult> {
        const jobId = ctx.job.id;
        if (jobWorkerMapping.has(jobId)) {
          processingCollisions.push(
            `Collision detected: Job ${jobId} was already claimed by ${jobWorkerMapping.get(jobId)} but is now being processed by ${workerName}!`,
          );
        }
        jobWorkerMapping.set(jobId, workerName);

        // Simulate varying asynchronous work duration to induce interleaving
        const simulatedDelay = Math.floor(Math.random() * 20) + 10;
        await new Promise((r) => setTimeout(r, simulatedDelay));

        return {
          status: "success",
          nextRunStatus: "understanding",
          output: { worker: workerName },
        };
      },
    });

    const workerA = new Worker({
      workerId: "worker-alpha",
      db: db1,
      pollIntervalMs: 15,
      getStageExecutor: () => createSharedExecutor("worker-alpha"),
    });

    const workerB = new Worker({
      workerId: "worker-beta",
      db: db2,
      pollIntervalMs: 15,
      getStageExecutor: () => createSharedExecutor("worker-beta"),
    });

    // Start both workers concurrently
    await Promise.all([workerA.start(), workerB.start()]);

    // Wait until all 10 jobs are finished
    const timeout = Date.now() + 10000;
    while (Date.now() < timeout) {
      const allDone = jobIds.every((id) => {
        const j = jobRepo1.getJob(id);
        return j?.status === "completed";
      });
      if (allDone) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    // Stop workers cleanly
    await Promise.all([workerA.stop(), workerB.stop()]);

    // Close db handles
    db1.close();
    db2.close();

    // 1. Assert NO collisions occurred
    expect(processingCollisions).toEqual([]);

    // 2. Assert all 10 jobs were processed
    expect(jobWorkerMapping.size).toBe(totalRuns);

    // 3. Assert both workers participated in processing (work stealing / sharing)
    const workersParticipating = new Set(jobWorkerMapping.values());
    expect(workersParticipating.has("worker-alpha")).toBe(true);
    expect(workersParticipating.has("worker-beta")).toBe(true);

    // 4. Verify all jobs in DB are marked completed with exactly 1 attempt
    const verifyDb = createDatabase({ path: testDbPath });
    const verifyJobRepo = new JobRepository(verifyDb);
    const verifyRunRepo = new RunRepository(verifyDb);
    const verifyAttemptsRepo = new StageAttemptRepository(verifyDb);

    for (const jobId of jobIds) {
      const job = verifyJobRepo.getJob(jobId);
      expect(job?.status).toBe("completed");
      expect(job?.attempts).toBe(1);
    }

    for (const runId of runIds) {
      const run = verifyRunRepo.get(runId);
      expect(run?.status).toBe("understanding");

      const attempts = verifyAttemptsRepo.listForRun(runId);
      expect(attempts.length).toBe(1);
      expect(attempts[0]?.status).toBe("completed");
    }

    verifyDb.close();
  });
});
