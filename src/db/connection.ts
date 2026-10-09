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
 * Switches the file to WAL mode. When two processes open a fresh file together, the
 * switch can fail with SQLITE_BUSY at once, without waiting on busy_timeout. Retry
 * until the same deadline busy_timeout would have used.
 */
function enableWalMode(db: Database, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (err: unknown) {
      const busy = (err as { code?: string }).code === "SQLITE_BUSY";
      if (!busy || Date.now() >= deadline) throw err;
      Bun.sleepSync(5);
    }
  }
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

  // Set the busy timeout first. Switching a fresh file to WAL takes a lock, and
  // without a timeout that switch fails at once when another process holds it.
  const timeout = options?.busyTimeoutMs ?? 5000;
  db.exec(`PRAGMA busy_timeout = ${timeout};`);

  // Standard production SQLite PRAGMAs
  if (!options?.readonly) {
    if (options?.wal !== false && dbPath !== ":memory:") {
      enableWalMode(db, timeout);
    }

    if (options?.foreignKeys !== false) {
      db.exec("PRAGMA foreign_keys = ON;");
    }

    // NORMAL is the usual pairing with WAL: commits stay durable across an
    // application crash and only an OS crash can lose the latest ones.
    db.exec("PRAGMA synchronous = NORMAL;");
  }

  return db;
}
