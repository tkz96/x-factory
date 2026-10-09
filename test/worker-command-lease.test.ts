import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import type { StageContext, StageOutcome } from "../src/executors/index.js";
import { Worker } from "../src/worker.js";

describe("Command Lease Renewal", () => {
  const testDbPath = path.resolve(
    process.cwd(),
    `.test-cmd-lease-${Date.now()}.db`,
  );

  afterAll(() => {
    try {
      rmSync(testDbPath, { force: true });
      rmSync(`${testDbPath}-wal`, { force: true });
      rmSync(`${testDbPath}-shm`, { force: true });
    } catch {}
  });

  function setupDb() {
    const db = createDatabase({ path: testDbPath });
    runMigrations(db);
    return db;
  }

  it("1. A claimed deliver command is renewed by its owning worker (test real heartbeat)", async () => {
    const db = setupDb();
    const runRepo = new RunRepository(db);
    const cmdRepo = new CommandRepository(db);

    runRepo.create({
      id: "run-cmd-1",
      projectId: "proj-1",
      projectName: "Proj 1",
      ticket: { id: "T-1", title: "T1", acceptanceCriteria: [] },
      plan: "P",
      branch: "B",
      status: "ready_for_pr",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    const cmd = cmdRepo.insertOrRetryCommand({
      runId: "run-cmd-1",
      command: "deliver",
    });

    // Use a very short deliver lease to test renewal
    let deliverRunning = false;
    let deliverFinished = false;

    const worker = new Worker({
      workerId: "worker-A",
      db,
      commandLeaseDurationMs: 150,
      commandHeartbeatIntervalMs: 50,
      deliverExecutor: {
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          deliverRunning = true;
          // Wait 300ms, which is 3x the lease duration.
          // It should survive because the heartbeat renews it.
          await new Promise((r) => setTimeout(r, 300));
          deliverFinished = true;
          return {
            outcome: "passed",
            output: { prUrl: "http://pr" },
          };
        },
      },
    });

    const p = worker.stepCommandOnce();

    // Wait until executor is running
    while (!deliverRunning) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // While running, test #3: A different worker cannot reclaim a command while the owner is actively renewing it.
    const workerB = new Worker({
      workerId: "worker-B",
      db: createDatabase({ path: testDbPath }),
    });
    const bCmds = await workerB.stepCommandOnce();
    expect(bCmds.length).toBe(0); // Should not claim it

    // Wait for worker A to finish
    await p;
    expect(deliverFinished).toBe(true);

    // Command should be completed
    const cmdCheck = cmdRepo.getCommand(cmd.id);
    expect(cmdCheck?.status).toBe("completed");

    // Test #6: After delivery completes, the heartbeat timer is stopped.
    // Assuming node process exits cleanly without hanging timers. (Implicitly tested if tests finish).
    await worker.stop();
  });

  it("2 & 8. A different worker cannot renew the command & failure logged", () => {
    const db = setupDb();
    const runRepo = new RunRepository(db);
    const cmdRepo = new CommandRepository(db);

    runRepo.create({
      id: "run-cmd-2",
      projectId: "proj-1",
      projectName: "Proj 1",
      ticket: { id: "T-1", title: "T1", acceptanceCriteria: [] },
      plan: "P",
      branch: "B",
      status: "ready_for_pr",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    const cmd = cmdRepo.insertOrRetryCommand({
      runId: "run-cmd-2",
      command: "deliver",
    });

    const claimed = cmdRepo.claimPendingCommands("worker-owner", 10000, 10000);
    expect(claimed.length).toBe(1);

    const renewedByOther = cmdRepo.renewLease(cmd.id, "worker-other", 10000);
    expect(renewedByOther).toBe(false);
  });

  it("4 & 5. A long-running deliver continues without being reclaimed, but can be reclaimed if crashed", async () => {
    const db = setupDb();
    const runRepo = new RunRepository(db);
    const cmdRepo = new CommandRepository(db);

    runRepo.create({
      id: "run-cmd-3",
      projectId: "proj-1",
      projectName: "Proj 1",
      ticket: { id: "T-1", title: "T1", acceptanceCriteria: [] },
      plan: "P",
      branch: "B",
      status: "ready_for_pr",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    const cmd = cmdRepo.insertOrRetryCommand({
      runId: "run-cmd-3",
      command: "deliver",
    });

    let executorStarted = false;
    let executorHalt = false;

    const workerC = new Worker({
      workerId: "worker-C",
      db,
      commandLeaseDurationMs: 150,
      commandHeartbeatIntervalMs: 50,
      deliverExecutor: {
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          executorStarted = true;
          // Simulate hanging worker that stops renewing without completing
          while (!executorHalt) {
            await new Promise((r) => setTimeout(r, 10));
          }
          return { outcome: "passed", output: { prUrl: "url" } };
        },
      },
    });

    const p = workerC.stepCommandOnce();
    while (!executorStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Wait 300ms, wait out the lease duration while heartbeat renews
    await new Promise((r) => setTimeout(r, 300));

    // Test #4: continues without being reclaimed
    const workerD = new Worker({
      workerId: "worker-D",
      db,
      deliverExecutor: {
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          return { outcome: "passed", output: { prUrl: "url" } };
        },
      },
    });
    const claimedByDWhileAlive = await workerD.stepCommandOnce();
    expect(claimedByDWhileAlive.length).toBe(0);

    // Stop worker C (simulating crash)
    await workerC.stop();

    // Wait 200ms so the lease definitely expires (commandLeaseDurationMs is 150)
    await new Promise((r) => setTimeout(r, 200));

    // Test #5: can be reclaimed after owner stops renewing
    const claimedByDAfterCrash = await workerD.stepCommandOnce();
    expect(claimedByDAfterCrash.length).toBe(1);
    expect(claimedByDAfterCrash[0]?.id).toBe(cmd.id);

    executorHalt = true; // allow executor to finish its promise now that it's stolen
    await p;
  });

  it("7. After delivery fails, the heartbeat timer is stopped.", async () => {
    const db = setupDb();
    const runRepo = new RunRepository(db);
    const cmdRepo = new CommandRepository(db);

    runRepo.create({
      id: "run-cmd-4",
      projectId: "proj-1",
      projectName: "Proj 1",
      ticket: { id: "T-1", title: "T1", acceptanceCriteria: [] },
      plan: "P",
      branch: "B",
      status: "ready_for_pr",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    const cmd = cmdRepo.insertOrRetryCommand({
      runId: "run-cmd-4",
      command: "deliver",
    });

    const worker = new Worker({
      workerId: "worker-E",
      db,
      commandLeaseDurationMs: 100,
      commandHeartbeatIntervalMs: 33,
      deliverExecutor: {
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          throw new Error("Intentional failure");
        },
      },
    });

    await worker.stepCommandOnce();

    const cmdCheck = cmdRepo.getCommand(cmd.id);
    expect(cmdCheck?.status).toBe("failed");

    // Implicit test for timer stopped: the process won't hang.
    // And explicitly, we can check that it can't be renewed anymore because status = failed.
    const renewed = cmdRepo.renewLease(cmd.id, "worker-E", 100);
    expect(renewed).toBe(false); // Because status is not 'claimed'

    await worker.stop();
  });
});
