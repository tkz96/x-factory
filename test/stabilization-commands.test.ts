// test/stabilization-commands.test.ts — Unit tests for command repository, leasing, idempotency, and heartbeats (v5.5).

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { CommandRepository } from "../src/db/command-repository.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { WorkerHeartbeatRepository } from "../src/db/worker-heartbeat-repository.js";
import { createPR } from "../src/runs.js";
import { Worker } from "../src/worker.js";

function setupTest() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);

  const runRepo = new RunRepository(db);
  const commandRepo = new CommandRepository(db);
  const eventRepo = new EventRepository(db);
  const heartbeatRepo = new WorkerHeartbeatRepository(db);

  const run = runRepo.create({
    id: "run-cmd-test-1",
    projectId: "proj-1",
    projectName: "Project 1",
    ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/cmd-1",
    status: "ready_for_pr",
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  });

  return { db, runRepo, commandRepo, eventRepo, heartbeatRepo, run };
}

describe("Stabilization Pass — Commands, Leasing & Heartbeats", () => {
  // Test 1: Command idempotency
  it("enforces command idempotency when duplicate idempotency key is supplied", () => {
    const { commandRepo, run } = setupTest();

    const cmd1 = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "stop",
      payload: { jobId: "job-1" },
      idempotencyKey: "stop:job-1",
      targetWorkerId: "worker-1",
    });

    const cmd2 = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "stop",
      payload: { jobId: "job-1" },
      idempotencyKey: "stop:job-1",
      targetWorkerId: "worker-1",
    });

    expect(cmd1.id).toBe(cmd2.id);
  });

  // Test 2: Command leasing & expiration recovery
  it("allows expired claimed commands to be reclaimed after lease expires", () => {
    const { commandRepo, run } = setupTest();

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: "deliver:1",
    });

    // Worker 1 claims command with short lease (1ms)
    const claimed1 = commandRepo.claimPendingCommands("worker-1", -1000);
    expect(claimed1.length).toBe(1);
    expect(claimed1[0]?.workerId).toBe("worker-1");

    // Immediately, worker 2 cannot claim if lease was valid, but since lease is in the past, worker 2 claims it
    const claimed2 = commandRepo.claimPendingCommands("worker-2", 30000);
    expect(claimed2.length).toBe(1);
    expect(claimed2[0]?.workerId).toBe("worker-2");
    expect(claimed2[0]?.attempts).toBe(2);
  });

  // Test 3: Stale targeted worker handling
  it("handles dead target workers: completes stop as no-op and fails steer", async () => {
    const { db, commandRepo, heartbeatRepo, run } = setupTest();

    // Register dead worker with old heartbeat (>30s ago)
    const deadTime = new Date(Date.now() - 60000).toISOString();
    heartbeatRepo.upsert({
      workerId: "dead-worker",
      pid: 9999,
      hostname: "test-host",
      lastHeartbeat: deadTime,
      startedAt: deadTime,
    });

    // 1. Stop targeted to dead worker
    const stopCmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "stop",
      payload: { jobId: "job-stale" },
      idempotencyKey: "stop:stale",
      targetWorkerId: "dead-worker",
    });

    // 2. Steer targeted to dead worker
    const steerCmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "steer",
      payload: { message: "stale steer" },
      idempotencyKey: "steer:stale",
      targetWorkerId: "dead-worker",
    });

    const worker = new Worker({
      db,
      workerId: "surviving-worker",
    });

    // Surviving worker runs command cycle on stop
    await worker.processCommand(stopCmd);
    const updatedStop = commandRepo.getCommand(stopCmd.id);
    expect(updatedStop?.status).toBe("completed");

    // Surviving worker runs command cycle on steer
    await worker.processCommand(steerCmd);
    const updatedSteer = commandRepo.getCommand(steerCmd.id);
    expect(updatedSteer?.status).toBe("failed");
    expect(updatedSteer?.error).toContain(
      "Target worker dead-worker is dead or inactive",
    );
  });

  // Test 10: Create PR atomicity & deduplication
  it("createPR returns completed if PR already exists, or queued if deliver command pending", async () => {
    const { db, runRepo, commandRepo, eventRepo, run } = setupTest();

    // First createPR call queues command
    const res1 = await createPR(run.id, {
      db,
      runRepo,
      commandRepo,
      eventRepo,
    });
    expect(res1.ok).toBe(true);
    expect(res1.queued).toBe(true);

    // Second concurrent call sees pending command and returns queued without duplicates
    const res2 = await createPR(run.id, {
      db,
      runRepo,
      commandRepo,
      eventRepo,
    });
    expect(res2.ok).toBe(true);
    expect(res2.queued).toBe(true);

    const commands = commandRepo.claimPendingCommands("worker-test", 30000);
    expect(commands.length).toBe(1);
  });

  // Test 12: Deliver retry on failed command
  it("createPR resets failed deliver command back to pending for retry", async () => {
    const { db, runRepo, commandRepo, eventRepo, run } = setupTest();

    // Insert failed deliver command
    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `deliver:${run.id}`,
    });
    commandRepo.failCommand(cmd.id, "Network timeout to GitHub");

    expect(commandRepo.getCommand(cmd.id)?.status).toBe("failed");

    // Operator triggers createPR again
    const res = await createPR(run.id, { db, runRepo, commandRepo, eventRepo });
    expect(res.ok).toBe(true);
    expect(res.queued).toBe(true);

    const retriedCmd = commandRepo.getCommand(cmd.id);
    expect(retriedCmd?.status).toBe("pending");
    expect(retriedCmd?.attempts).toBe(0);
    expect(retriedCmd?.error).toBeNull();
  });

  // Test 23: Worker heartbeat UPSERT preserves started_at
  it("preserves started_at on heartbeat upsert while updating last_heartbeat", async () => {
    const { heartbeatRepo } = setupTest();

    const base = Date.now() - 60000;
    const t1 = new Date(base).toISOString();
    heartbeatRepo.upsert({
      workerId: "worker-upsert",
      pid: 1234,
      hostname: "host-1",
      lastHeartbeat: t1,
      startedAt: t1,
    });

    const initial = heartbeatRepo.getActiveWorkers(3600000);
    const w1 = initial.find((w) => w.workerId === "worker-upsert");
    expect(w1?.startedAt).toBe(t1);
    expect(w1?.lastHeartbeat).toBe(t1);

    const t2 = new Date(base + 10000).toISOString();
    heartbeatRepo.upsert({
      workerId: "worker-upsert",
      pid: 1234,
      hostname: "host-1",
      lastHeartbeat: t2,
      startedAt: t2, // should be ignored by ON CONFLICT
    });

    const updated = heartbeatRepo.getActiveWorkers(3600000);
    const w2 = updated.find((w) => w.workerId === "worker-upsert");
    expect(w2?.startedAt).toBe(t1); // preserved!
    expect(w2?.lastHeartbeat).toBe(t2); // updated!
  });
});
