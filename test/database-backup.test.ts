// test/database-backup.test.ts — Live WAL backup and restoration verification (XFM-72).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { backupDatabase, restoreDatabase } from "../src/db/backup.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";

describe("Live Database Backup & Recovery (XFM-72)", () => {
  const liveDbPath = `/tmp/test-live-${Date.now()}.db`;
  const backupPath = `/tmp/test-backup-${Date.now()}.db`;
  const restorePath = `/tmp/test-restored-${Date.now()}.db`;

  beforeEach(() => {
    // Cleanup any lingering test databases
    for (const p of [liveDbPath, backupPath, restorePath]) {
      if (existsSync(p)) unlinkSync(p);
      if (existsSync(`${p}-wal`)) unlinkSync(`${p}-wal`);
      if (existsSync(`${p}-shm`)) unlinkSync(`${p}-shm`);
    }
  });

  afterEach(() => {
    for (const p of [liveDbPath, backupPath, restorePath]) {
      if (existsSync(p)) unlinkSync(p);
      if (existsSync(`${p}-wal`)) unlinkSync(`${p}-wal`);
      if (existsSync(`${p}-shm`)) unlinkSync(`${p}-shm`);
    }
  });

  it("creates a verified, consistent atomic backup while database is in WAL mode", async () => {
    const db = createDatabase({ path: liveDbPath });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const eventRepo = new EventRepository(db);
    const attemptRepo = new StageAttemptRepository(db);

    // Populate data
    const run = runRepo.create({
      id: "run-backup-1",
      projectId: "proj-1",
      projectName: "Backup Project",
      ticket: { id: "BKP-1", title: "Backup Ticket", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/bkp-1",
      status: "implementing",
      artifactsDir: "/tmp/a",
      worktreePath: "/tmp/w",
    });

    jobRepo.createJob({ runId: run.id, stage: "prepare", status: "completed" });
    jobRepo.createJob({ runId: run.id, stage: "implement", status: "pending" });

    eventRepo.appendEvent(run.id, "status", { status: "implementing" });
    const att = attemptRepo.recordStart(run.id, "prepare", 1);
    attemptRepo.recordCompletion(att.id, { ok: true });

    // Execute atomic live backup
    const backupResult = await backupDatabase(db, backupPath);

    expect(backupResult.backupPath).toBe(backupPath);
    expect(backupResult.integrity).toBe("ok");
    expect(backupResult.schemaVersion).toBe(8);
    expect(backupResult.stats.runs).toBe(1);
    expect(backupResult.stats.jobs).toBe(2);
    expect(backupResult.stats.events).toBe(1);
    expect(backupResult.stats.stageAttempts).toBe(1);
    expect(backupResult.sizeBytes).toBeGreaterThan(0);

    // Verify backup file exists and is readable
    expect(existsSync(backupPath)).toBe(true);

    db.close();
  });

  it("restores database from backup snapshot and verifies full data fidelity", async () => {
    const liveDb = createDatabase({ path: liveDbPath });
    runMigrations(liveDb);

    const runRepo = new RunRepository(liveDb);
    const run = runRepo.create({
      id: "run-fidelity-test",
      projectId: "proj-fid",
      projectName: "Fidelity Project",
      ticket: {
        id: "FID-1",
        title: "Fidelity Ticket",
        acceptanceCriteria: ["AC-1"],
      },
      plan: "Fidelity Plan",
      branch: "factory/fid-1",
      status: "reviewing",
      artifactsDir: "/tmp/afid",
      worktreePath: "/tmp/wfid",
    });

    // Create backup
    await backupDatabase(liveDb, backupPath);
    liveDb.close();

    // Restore to fresh location
    const restoreResult = await restoreDatabase(backupPath, restorePath);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.schemaVersion).toBe(8);
    expect(existsSync(restorePath)).toBe(true);

    // Open restored database and query data
    const restoredDb = createDatabase({ path: restorePath, readonly: true });
    try {
      const restoredRunRepo = new RunRepository(restoredDb);
      const fetchedRun = restoredRunRepo.get(run.id);

      expect(fetchedRun).not.toBeNull();
      expect(fetchedRun?.id).toBe("run-fidelity-test");
      expect(fetchedRun?.ticket.title).toBe("Fidelity Ticket");
      expect(fetchedRun?.status).toBe("reviewing");
    } finally {
      restoredDb.close();
    }
  });

  it("rejects restoration if backup file does not exist", async () => {
    expect(
      restoreDatabase("/nonexistent/file.db", restorePath),
    ).rejects.toThrow("Backup file not found");
  });
});
