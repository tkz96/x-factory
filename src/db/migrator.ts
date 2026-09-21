// src/db/migrator.ts — Deterministic SQLite migration runner with schema version authority.

import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Discovers and parses migration SQL files from the migrations directory.
 */
export function loadMigrations(migrationsDir?: string): Migration[] {
  const dir = migrationsDir || path.join(import.meta.dir, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  const migrations: Migration[] = [];
  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    const version = parseInt(match[1] as string, 10);
    const name = match[2] as string;
    const sql = readFileSync(path.join(dir, file), "utf-8");
    migrations.push({ version, name, sql });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

let cachedLatestMigrationVersion: number | null = null;

export function resetMigrationVersionCacheForTesting(): void {
  cachedLatestMigrationVersion = null;
}

/**
 * Returns the highest migration version defined in the codebase.
 * Memoizes the result to avoid parsing filesystem migrations repeatedly on diagnostics routes.
 */
export function getLatestMigrationVersion(migrationsDir?: string): number {
  if (cachedLatestMigrationVersion !== null && !migrationsDir) {
    return cachedLatestMigrationVersion;
  }
  const migrations = loadMigrations(migrationsDir);
  const version =
    migrations.length > 0
      ? (migrations[migrations.length - 1]?.version ?? 0)
      : 0;
  if (!migrationsDir) {
    cachedLatestMigrationVersion = version;
  }
  return version;
}

/**
 * Returns the latest applied schema version from the database, or 0 if uninitialized.
 */
export function getSchemaVersion(db: Database): number {
  try {
    const tableExists = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations';",
      )
      .get();
    if (!tableExists) return 0;

    const row = db
      .query("SELECT MAX(version) as latest_version FROM schema_migrations;")
      .get() as { latest_version: number | null } | null;
    return row?.latest_version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Runs all pending migrations deterministically in version order.
 * Fails fast if the database schema is newer than the application code.
 */
export function runMigrations(
  db: Database,
  customMigrations?: Migration[],
): { applied: number; currentVersion: number } {
  const migrations = customMigrations ?? loadMigrations();
  const maxCodeVersion =
    migrations.length > 0
      ? (migrations[migrations.length - 1]?.version ?? 0)
      : 0;
  const currentDbVersion = getSchemaVersion(db);

  if (currentDbVersion > maxCodeVersion) {
    throw new Error(
      `Database schema version ${currentDbVersion} is newer than application code version ${maxCodeVersion}. Refusing to accept work with unknown schema.`,
    );
  }

  let appliedCount = 0;

  for (const m of migrations) {
    if (m.version <= currentDbVersion) continue;

    const executeMigration = db.transaction(() => {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);",
      ).run(m.version, m.name, new Date().toISOString());
    });

    try {
      executeMigration();
      appliedCount++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed executing migration ${m.version}_${m.name}: ${message}`,
      );
    }
  }

  const finalVersion = getSchemaVersion(db);
  return { applied: appliedCount, currentVersion: finalVersion };
}
