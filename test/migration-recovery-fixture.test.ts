// test/migration-recovery-fixture.test.ts — Migration, integrity verification, and recovery test fixture (XFM-68).

import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import {
  getSchemaVersion,
  loadMigrations,
  runMigrations,
} from "../src/db/migrator.js";

describe("Migration & Recovery Test Fixture (XFM-68)", () => {
  const testDbFile = path.resolve(
    process.cwd(),
    `.test-migration-fixture-${Date.now()}.db`,
  );

  afterAll(() => {
    try {
      rmSync(testDbFile, { force: true });
      rmSync(`${testDbFile}-wal`, { force: true });
      rmSync(`${testDbFile}-shm`, { force: true });
    } catch {
      // ignore cleanup
    }
  });

  it("migrates incrementally from older schema (v3) to latest (v8) preserving existing data", () => {
    const db = createDatabase({ path: ":memory:" });
    const allMigrations = loadMigrations();

    // 1. Apply only migrations 1 through 3
    const v3Migrations = allMigrations.filter((m) => m.version <= 3);
    const step1 = runMigrations(db, v3Migrations);
    expect(step1.currentVersion).toBe(3);
    expect(step1.applied).toBe(3);

    // 2. Insert pre-existing historical records in v3 schema
    db.prepare(`
      INSERT INTO runs (
        id, project_id, project_name, ticket_id, ticket_title,
        ticket_acceptance_criteria, plan, branch, status, started_at,
        artifacts_dir, worktree_path, revision, created_at, updated_at
      ) VALUES (
        'run-v3-legacy', 'proj-1', 'Legacy Proj', 'LEG-1', 'Legacy Ticket',
        '[]', 'Plan', 'factory/legacy', 'preparing', '2026-01-01T00:00:00Z',
        '/tmp/artifacts-leg', '/tmp/worktree-leg', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      );
    `).run();

    db.prepare(`
      INSERT INTO jobs (
        id, run_id, stage, status, attempts, max_attempts,
        available_at, created_at, updated_at
      ) VALUES (
        'job-v3-legacy', 'run-v3-legacy', 'prepare', 'pending', 0, 3,
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      );
    `).run();

    // 3. Migrate incrementally to latest schema version 8
    const step2 = runMigrations(db, allMigrations);
    expect(step2.applied).toBe(5); // 4, 5, 6, 7, 8 applied
    expect(step2.currentVersion).toBe(8);
    expect(getSchemaVersion(db)).toBe(8);

    // 4. Verify pre-existing data was preserved completely
    const preservedRun = db
      .query("SELECT * FROM runs WHERE id = 'run-v3-legacy';")
      .get() as { ticket_title: string } | null;
    expect(preservedRun).not.toBeNull();
    expect(preservedRun?.ticket_title).toBe("Legacy Ticket");

    const preservedJob = db
      .query("SELECT * FROM jobs WHERE id = 'job-v3-legacy';")
      .get() as { stage: string; status: string } | null;
    expect(preservedJob).not.toBeNull();
    expect(preservedJob?.stage).toBe("prepare");
    expect(preservedJob?.status).toBe("pending");
  });

  it("verifies all 8 tables and critical performance indexes exist in latest schema", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    // Tables check
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table';")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("schema_migrations");
    expect(tableNames).toContain("runs");
    expect(tableNames).toContain("jobs");
    expect(tableNames).toContain("run_events");
    expect(tableNames).toContain("stage_attempts");
    expect(tableNames).toContain("operation_ledger");
    expect(tableNames).toContain("run_commands");
    expect(tableNames).toContain("worker_heartbeats");

    // Indexes check
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index';")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_jobs_run_id");
    expect(indexNames).toContain("idx_jobs_claimable");
    expect(indexNames).toContain("idx_run_events_run_sequence");
    expect(indexNames).toContain("idx_stage_attempts_run_stage");
    expect(indexNames).toContain("idx_operation_ledger_run_op");
    expect(indexNames).toContain("idx_run_commands_pending");
  });

  it("passes PRAGMA integrity_check with zero errors", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const check = db.query("PRAGMA integrity_check;").get() as {
      integrity_check: string;
    };
    expect(check.integrity_check).toBe("ok");
  });

  it("configures WAL mode and busy_timeout on file-backed database", () => {
    const db = createDatabase({ path: testDbFile });
    runMigrations(db);

    const journalMode = db.query("PRAGMA journal_mode;").get() as {
      journal_mode: string;
    };
    expect(journalMode.journal_mode.toLowerCase()).toBe("wal");

    const busyTimeout = db.query("PRAGMA busy_timeout;").get() as {
      timeout: number;
    };
    expect(busyTimeout.timeout).toBe(5000);

    const integrity = db.query("PRAGMA integrity_check;").get() as {
      integrity_check: string;
    };
    expect(integrity.integrity_check).toBe("ok");

    db.close();
  });
});
