// test/db-migrations.test.ts — Unit tests for SQLite connection and deterministic migration runner.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * splitStatements (src/db/migrator.ts) drops whole-line `--` comments, then
 * splits on every semicolon. Any construct below breaks that split, so a
 * migration that uses one would run as broken SQL. Each violation names the
 * construct and why it is a problem.
 */
function splitterViolations(sql: string): string[] {
  const violations: string[] = [];
  const lines = sql.split("\n");

  if (/\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(sql)) {
    violations.push(
      "CREATE TRIGGER: its body holds semicolons, so the splitter cuts the trigger apart.",
    );
  }
  if (sql.includes("/*") || sql.includes("*/")) {
    violations.push(
      "/* */ block comment: the splitter removes only whole-line -- comments, so a semicolon inside a block comment would split a statement.",
    );
  }
  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("--") && line.includes("--")) {
      violations.push(
        `line ${index + 1}: trailing -- comment: the splitter removes only whole-line -- comments, so a semicolon in the comment would split a statement. Move the comment onto its own line.`,
      );
    }
  });

  // Semicolons inside string literals or quoted identifiers, checked on SQL with
  // whole-line comments removed.
  const code = lines
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const literal of code.match(/'(?:[^']|'')*'/g) ?? []) {
    if (literal.includes(";")) {
      violations.push(
        `string literal ${literal} contains a semicolon: the splitter splits on every semicolon, even inside a string literal.`,
      );
    }
  }
  for (const identifier of code.match(/"(?:[^"]|"")*"/g) ?? []) {
    if (identifier.includes(";")) {
      violations.push(
        `quoted identifier ${identifier} contains a semicolon: the splitter splits on every semicolon, even inside a quoted identifier.`,
      );
    }
  }
  return violations;
}

describe("Migration SQL stays within what splitStatements can split", () => {
  const migrationsDir = path.join(
    import.meta.dir,
    "..",
    "src",
    "db",
    "migrations",
  );

  it("no migration uses a construct the statement splitter cannot handle", () => {
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap((file) =>
      splitterViolations(
        readFileSync(path.join(migrationsDir, file), "utf-8"),
      ).map((violation) => `${file}: ${violation}`),
    );
    expect(violations).toEqual([]);
  });

  it("the scanner flags each construct it is meant to catch", () => {
    expect(
      splitterViolations(
        "CREATE TRIGGER t AFTER INSERT ON runs BEGIN SELECT 1; END;",
      ),
    ).toHaveLength(1);
    expect(splitterViolations("/* note */\nSELECT 1;")).toHaveLength(1);
    expect(splitterViolations("SELECT 1; -- trailing\n")).toHaveLength(1);
    expect(splitterViolations("INSERT INTO t VALUES ('a;b');")).toHaveLength(1);
    expect(splitterViolations('CREATE TABLE "a;b" (x INTEGER);')).toHaveLength(
      1,
    );
    expect(splitterViolations("-- whole line; comment\nSELECT 1;\n")).toEqual(
      [],
    );
  });
});
