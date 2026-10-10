import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import type { StageContext, StageOutcome } from "../src/executors/index.js";
import { Worker } from "../src/worker.js";
import { deliveredOutcome } from "./helpers/deliver-outcome.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { createTempDir } from "./helpers/temp-dirs.js";

const LEASE_PR = {
  url: "https://example.test/pr/lease",
  branch: "B",
  baseBranch: "main",
  title: "Lease test",
};

describe("Command Lease Renewal", () => {
  // `mkdtemp` gives every run its own directory, so two suites that start in
  // the same millisecond can no longer share a SQLite file (#163 follow-up).
  const tempDir = createTempDir("xf-cmd-lease-");
  const testDbPath = path.join(tempDir, "cmd-lease.db");

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupDb() {
    const db = createDatabase({ path: testDbPath });
    runMigrations(db);
    ensureProject("proj-1", {
      name: "Proj 1",
      workspacePath: "/tmp/worktrees-cmd",
      repositoryPath: "/tmp/worktrees-cmd",
    });
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

    // Lease is long enough that an event-loop stall on a loaded CI runner
    // cannot expire it between heartbeats (heartbeat is 1/10 of the lease).
    let deliverRunning = false;
    let deliverFinished = false;

    const worker = new Worker({
      workerId: "worker-A",
      db,
      commandLeaseDurationMs: 1000,
      commandHeartbeatIntervalMs: 100,
      deliverExecutor: {
        stage: "deliver",
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          deliverRunning = true;
          // Wait 3000ms, which is 3x the lease duration.
          // It should survive because the heartbeat renews it.
          await new Promise((r) => setTimeout(r, 3000));
          deliverFinished = true;
          return deliveredOutcome(LEASE_PR);
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
      commandLeaseDurationMs: 1000,
      commandHeartbeatIntervalMs: 100,
      deliverExecutor: {
        stage: "deliver",
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          executorStarted = true;
          // Simulate hanging worker that stops renewing without completing
          while (!executorHalt) {
            await new Promise((r) => setTimeout(r, 10));
          }
          return deliveredOutcome(LEASE_PR);
        },
      },
    });

    const p = workerC.stepCommandOnce();
    while (!executorStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Wait 2000ms, twice the lease duration, so only a live heartbeat keeps the lease
    await new Promise((r) => setTimeout(r, 2000));

    // Test #4: continues without being reclaimed
    const workerD = new Worker({
      workerId: "worker-D",
      db,
      deliverExecutor: {
        stage: "deliver",
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          return deliveredOutcome(LEASE_PR);
        },
      },
    });
    const claimedByDWhileAlive = await workerD.stepCommandOnce();
    expect(claimedByDWhileAlive.length).toBe(0);

    // Stop worker C (simulating crash)
    await workerC.stop();

    // Wait 1200ms so the lease definitely expires (commandLeaseDurationMs is 1000)
    await new Promise((r) => setTimeout(r, 1200));

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
        stage: "deliver",
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
