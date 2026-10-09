// test/migrator-failure.test.ts — A failing statement aborts its migration and is
// never swallowed (#188 follow-up). Bun's multi-statement exec does not throw on
// a foreign-key violation, so each statement must run on its own.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { getSchemaVersion, runMigrations } from "../src/db/migrator.js";

function tableNames(db: ReturnType<typeof createDatabase>): string[] {
  return (
    db
      .query("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all() as Array<{ name: string }>
  ).map((t) => t.name);
}

describe("migrator fails loudly", () => {
  it("aborts at a foreign-key violation in the middle and rolls back earlier statements", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const before = getSchemaVersion(db);

    const broken = {
      version: 99,
      name: "broken_fk_middle",
      sql: [
        "CREATE TABLE migrator_probe_parent (id TEXT PRIMARY KEY);",
        "CREATE TABLE migrator_probe_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES migrator_probe_parent(id));",
        "INSERT INTO migrator_probe_child (id, parent_id) VALUES ('c1', 'ghost');",
        "CREATE TABLE migrator_probe_after (id TEXT PRIMARY KEY);",
      ].join("\n"),
    };

    expect(() => runMigrations(db, [broken])).toThrow(
      /Failed executing migration 99_broken_fk_middle/,
    );
    expect(getSchemaVersion(db)).toBe(before);
    const tables = tableNames(db);
    expect(tables).not.toContain("migrator_probe_parent");
    expect(tables).not.toContain("migrator_probe_child");
    expect(tables).not.toContain("migrator_probe_after");
    db.close();
  });

  it("aborts at an unknown table in the middle and rolls back earlier statements", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const before = getSchemaVersion(db);

    const broken = {
      version: 98,
      name: "broken_missing_table",
      sql: [
        "CREATE TABLE migrator_probe_a (id TEXT PRIMARY KEY);",
        "INSERT INTO table_that_does_not_exist VALUES (1);",
        "CREATE TABLE migrator_probe_b (id TEXT PRIMARY KEY);",
      ].join("\n"),
    };

    expect(() => runMigrations(db, [broken])).toThrow(
      /Failed executing migration 98_broken_missing_table/,
    );
    expect(getSchemaVersion(db)).toBe(before);
    expect(tableNames(db)).not.toContain("migrator_probe_a");
    expect(tableNames(db)).not.toContain("migrator_probe_b");
    db.close();
  });
});
