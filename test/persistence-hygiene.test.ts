// test/persistence-hygiene.test.ts — Regression tests for #188: writable connection
// durability and the run_commands cascade on run delete (migration 009).

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import {
  getSchemaVersion,
  loadMigrations,
  runMigrations,
} from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";

function seedRun(repo: RunRepository, id: string, status: string): void {
  repo.create({
    id,
    projectId: "p1",
    projectName: "Proj 1",
    ticket: { id: `T-${id}`, title: "Ticket", acceptanceCriteria: [] },
    plan: "plan",
    branch: `factory/${id}`,
    status: status as never,
    artifactsDir: `/tmp/a-${id}`,
    worktreePath: `/tmp/w-${id}`,
  });
}

describe("writable connections (#188)", () => {
  let dir: string;
  let db: Database | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "xf-188-conn-"));
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("sets PRAGMA synchronous = NORMAL (1) on a file-backed writable connection", () => {
    db = createDatabase({ path: path.join(dir, "x.db") });
    const row = db.query("PRAGMA synchronous;").get() as {
      synchronous: number;
    };
    expect(row.synchronous).toBe(1);
  });

  it("sets synchronous = NORMAL explicitly even when WAL is off, not via the journal-mode default", () => {
    db = createDatabase({ path: path.join(dir, "rollback.db"), wal: false });
    const mode = db.query("PRAGMA journal_mode;").get() as {
      journal_mode: string;
    };
    expect(mode.journal_mode).toBe("delete");
    const row = db.query("PRAGMA synchronous;").get() as {
      synchronous: number;
    };
    expect(row.synchronous).toBe(1);
  });
});

describe("migration 009: run_commands.run_id ON DELETE CASCADE (#188)", () => {
  it("keeps existing rows, columns and indexes, and cascades run deletes", () => {
    const db = createDatabase({ path: ":memory:" });
    const all = loadMigrations();
    const before = all.filter((m) => m.version <= 8);
    runMigrations(db, before);
    expect(getSchemaVersion(db)).toBe(8);

    const runs = new RunRepository(db);
    seedRun(runs, "run-keep", "executing");
    seedRun(runs, "run-drop", "stopped");

    db.prepare(
      `INSERT INTO run_commands (id, run_id, command, payload, idempotency_key,
        status, attempts, max_attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ).run(
      "cmd-keep",
      "run-keep",
      "stop",
      '{"reason":"user"}',
      "idem-keep",
      "pending",
      0,
      3,
      "2026-10-01T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO run_commands (id, run_id, command, status, attempts, max_attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
    ).run(
      "cmd-drop",
      "run-drop",
      "deliver",
      "pending",
      0,
      3,
      "2026-10-01T00:00:01.000Z",
    );

    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(9);

    const kept = db
      .query(
        "SELECT id, run_id, command, payload, idempotency_key, status, attempts, max_attempts, created_at FROM run_commands ORDER BY id;",
      )
      .all();
    expect(kept).toEqual([
      {
        id: "cmd-drop",
        run_id: "run-drop",
        command: "deliver",
        payload: null,
        idempotency_key: null,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: "2026-10-01T00:00:01.000Z",
      },
      {
        id: "cmd-keep",
        run_id: "run-keep",
        command: "stop",
        payload: '{"reason":"user"}',
        idempotency_key: "idem-keep",
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const fk = db
      .query("PRAGMA foreign_key_list(run_commands);")
      .all() as Array<{ from: string; table: string; on_delete: string }>;
    expect(fk).toEqual([
      expect.objectContaining({
        from: "run_id",
        table: "runs",
        on_delete: "CASCADE",
      }),
    ]);

    const indexes = (
      db.query("PRAGMA index_list(run_commands);").all() as Array<{
        name: string;
        unique: number;
      }>
    ).map((i) => `${i.name}:${i.unique}`);
    expect(indexes).toContain("idx_run_commands_pending:0");
    expect(indexes.some((i) => i.endsWith(":1"))).toBe(true);

    db.exec("PRAGMA foreign_keys = ON;");
    db.prepare("DELETE FROM runs WHERE id = ?;").run("run-drop");
    const remaining = db
      .query("SELECT id FROM run_commands ORDER BY id;")
      .all() as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual(["cmd-keep"]);
    db.close();
  });
});

describe("migration 009 with orphan run_commands rows (#188 follow-up)", () => {
  it("keeps every valid row with all its values and drops only the orphan", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(
      db,
      loadMigrations().filter((m) => m.version <= 8),
    );

    const runs = new RunRepository(db);
    seedRun(runs, "run-a", "executing");
    seedRun(runs, "run-b", "stopped");

    const insert = db.prepare(
      `INSERT INTO run_commands (id, run_id, command, payload, idempotency_key,
        target_worker_id, status, worker_id, lease_until, attempts, max_attempts,
        error, result, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    );
    insert.run(
      "cmd-1",
      "run-a",
      "stop",
      '{"reason":"user"}',
      "idem-1",
      "w-1",
      "completed",
      "w-1",
      "2026-10-01T00:05:00.000Z",
      2,
      5,
      "boom",
      '{"ok":true}',
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:06:00.000Z",
    );
    insert.run(
      "cmd-2",
      "run-a",
      "deliver",
      null,
      null,
      null,
      "pending",
      null,
      null,
      0,
      3,
      null,
      null,
      "2026-10-01T00:00:01.000Z",
      null,
    );
    insert.run(
      "cmd-3",
      "run-b",
      "stop",
      null,
      "idem-3",
      null,
      "claimed",
      "w-2",
      "2026-10-01T00:09:00.000Z",
      1,
      3,
      null,
      null,
      "2026-10-01T00:00:02.000Z",
      null,
    );
    // Orphan: run_id points at a run that does not exist. Foreign keys are off only to seed it.
    db.exec("PRAGMA foreign_keys = OFF;");
    insert.run(
      "cmd-orphan",
      "run-missing",
      "deliver",
      null,
      null,
      null,
      "pending",
      null,
      null,
      0,
      3,
      null,
      null,
      "2026-10-01T00:00:03.000Z",
      null,
    );
    db.exec("PRAGMA foreign_keys = ON;");

    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(9);

    const rows = db
      .query("SELECT * FROM run_commands ORDER BY id;")
      .all() as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(["cmd-1", "cmd-2", "cmd-3"]);
    expect(rows[0]).toEqual({
      id: "cmd-1",
      run_id: "run-a",
      command: "stop",
      payload: '{"reason":"user"}',
      idempotency_key: "idem-1",
      target_worker_id: "w-1",
      status: "completed",
      worker_id: "w-1",
      lease_until: "2026-10-01T00:05:00.000Z",
      attempts: 2,
      max_attempts: 5,
      error: "boom",
      result: '{"ok":true}',
      created_at: "2026-10-01T00:00:00.000Z",
      processed_at: "2026-10-01T00:06:00.000Z",
    });
    expect(rows[2]).toEqual({
      id: "cmd-3",
      run_id: "run-b",
      command: "stop",
      payload: null,
      idempotency_key: "idem-3",
      target_worker_id: null,
      status: "claimed",
      worker_id: "w-2",
      lease_until: "2026-10-01T00:09:00.000Z",
      attempts: 1,
      max_attempts: 3,
      error: null,
      result: null,
      created_at: "2026-10-01T00:00:02.000Z",
      processed_at: null,
    });
    db.close();
  });

  it("keeps the partial pending index and the column defaults", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const indexSql = (
      db
        .query(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_commands_pending';",
        )
        .get() as { sql: string }
    ).sql;
    expect(indexSql).toContain("ON run_commands(status, created_at)");
    expect(indexSql).toMatch(/WHERE status = 'pending'$/);

    const defaults = (
      db.query("PRAGMA table_info(run_commands);").all() as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).reduce<Record<string, string | null>>((acc, col) => {
      acc[col.name] = col.dflt_value;
      return acc;
    }, {});
    expect(defaults.status).toBe("'pending'");
    expect(defaults.attempts).toBe("0");
    expect(defaults.max_attempts).toBe("3");
    db.close();
  });
});
