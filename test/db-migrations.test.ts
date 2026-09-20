// test/db-migrations.test.ts — Unit tests for SQLite connection and deterministic migration runner.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import {
  getSchemaVersion,
  loadMigrations,
  runMigrations,
} from "../src/db/migrator.js";

describe("SQLite Migrations Runner", () => {
  it("loads ordered migrations from disk", () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.name).toBe("initial");
    expect(migrations[1]?.version).toBe(2);
    expect(migrations[1]?.name).toBe("runs");
    expect(migrations[2]?.version).toBe(3);
    expect(migrations[2]?.name).toBe("jobs");
  });

  it("applies migrations cleanly to an in-memory database", () => {
    const db = createDatabase({ path: ":memory:" });
    expect(getSchemaVersion(db)).toBe(0);

    const result = runMigrations(db);
    expect(result.applied).toBeGreaterThanOrEqual(3);
    expect(result.currentVersion).toBeGreaterThanOrEqual(3);
    expect(getSchemaVersion(db)).toBe(result.currentVersion);

    // Verify tables exist
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC;",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("schema_migrations");
    expect(tableNames).toContain("runs");
    expect(tableNames).toContain("jobs");
  });

  it("is idempotent when run multiple times", () => {
    const db = createDatabase({ path: ":memory:" });
    const firstRun = runMigrations(db);
    expect(firstRun.applied).toBeGreaterThanOrEqual(3);

    const secondRun = runMigrations(db);
    expect(secondRun.applied).toBe(0);
    expect(secondRun.currentVersion).toBe(firstRun.currentVersion);
  });

  it("rejects database with higher version than known migrations", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    // Artificially inject a future version into schema_migrations
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);",
    ).run(999, "future_feature", new Date().toISOString());

    expect(() => runMigrations(db)).toThrow(
      /newer than application code version/,
    );
  });
});
