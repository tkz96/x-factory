// src/db/connection.ts — SQLite database connection factory and PRAGMA configuration using bun:sqlite.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getDatabasePath } from "../paths.js";

export interface DatabaseOptions {
  path?: string | undefined;
  wal?: boolean | undefined;
  foreignKeys?: boolean | undefined;
  busyTimeoutMs?: number | undefined;
  readonly?: boolean | undefined;
}

/**
 * Creates and configures a fresh SQLite database connection.
 */
export function createDatabase(options?: DatabaseOptions): Database {
  const dbPath = options?.path || getDatabasePath();

  if (dbPath !== ":memory:" && !options?.readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, {
    create: !options?.readonly,
    readonly: options?.readonly ?? false,
  });

  // Standard production SQLite PRAGMAs
  if (!options?.readonly) {
    if (options?.wal !== false && dbPath !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL;");
    }

    if (options?.foreignKeys !== false) {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  const timeout = options?.busyTimeoutMs ?? 5000;
  db.exec(`PRAGMA busy_timeout = ${timeout};`);

  return db;
}
