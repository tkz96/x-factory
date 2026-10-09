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
