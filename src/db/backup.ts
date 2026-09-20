// src/db/backup.ts — Safe, transactionally consistent live SQLite backup & verification (XFM-72).

import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "./connection.js";
import { getSchemaVersion } from "./migrator.js";

export interface BackupResult {
  backupPath: string;
  sizeBytes: number;
  schemaVersion: number;
  timestamp: string;
  integrity: string;
  stats: {
    runs: number;
    jobs: number;
    events: number;
    stageAttempts: number;
  };
}

/**
 * Creates a transactionally consistent, zero-lock live backup of a WAL-mode SQLite database.
 * Uses `VACUUM INTO` which flushes the WAL log and produces a clean, self-contained standalone database.
 * NEVER uses raw file copy, which produces corrupted databases in WAL mode.
 */
export async function backupDatabase(
  db: Database,
  targetPath: string,
): Promise<BackupResult> {
  const dir = path.dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // VACUUM INTO fails if the target file already exists; unlink prior file if present
  if (existsSync(targetPath)) {
    unlinkSync(targetPath);
  }

  // Execute atomic VACUUM INTO snapshot
  db.run("VACUUM INTO ?;", [targetPath]);

  // Open and verify integrity of the generated backup
  const backupDb = createDatabase({ path: targetPath, readonly: true });
  try {
    const integrityRow = backupDb.query("PRAGMA integrity_check;").get() as {
      integrity_check: string;
    } | null;
    const integrity = integrityRow?.integrity_check || "unknown";

    if (integrity !== "ok") {
      throw new Error(`Backup database failed integrity check: ${integrity}`);
    }

    const version = getSchemaVersion(backupDb);

    const runCount =
      (
        backupDb.query("SELECT COUNT(*) as count FROM runs;").get() as {
          count: number;
        } | null
      )?.count ?? 0;

    const jobCount =
      (
        backupDb.query("SELECT COUNT(*) as count FROM jobs;").get() as {
          count: number;
        } | null
      )?.count ?? 0;

    const eventCount =
      (
        backupDb.query("SELECT COUNT(*) as count FROM run_events;").get() as {
          count: number;
        } | null
      )?.count ?? 0;

    const attemptCount =
      (
        backupDb
          .query("SELECT COUNT(*) as count FROM stage_attempts;")
          .get() as { count: number } | null
      )?.count ?? 0;

    const sizeBytes = statSync(targetPath).size;

    return {
      backupPath: targetPath,
      sizeBytes,
      schemaVersion: version,
      timestamp: new Date().toISOString(),
      integrity,
      stats: {
        runs: runCount,
        jobs: jobCount,
        events: eventCount,
        stageAttempts: attemptCount,
      },
    };
  } finally {
    backupDb.close();
  }
}

/**
 * Restores a SQLite database from a backup file after verifying its integrity.
 */
export async function restoreDatabase(
  backupPath: string,
  targetDbPath: string,
): Promise<{ ok: boolean; schemaVersion: number }> {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found at ${backupPath}`);
  }

  // Pre-flight integrity verification of the backup
  const verifyDb = createDatabase({ path: backupPath, readonly: true });
  let version = 0;
  try {
    const integrityRow = verifyDb.query("PRAGMA integrity_check;").get() as {
      integrity_check: string;
    } | null;
    if (integrityRow?.integrity_check !== "ok") {
      throw new Error(
        `Corrupt backup file: integrity_check returned "${integrityRow?.integrity_check}"`,
      );
    }
    version = getSchemaVersion(verifyDb);
  } finally {
    verifyDb.close();
  }

  // Target directory creation
  const targetDir = path.dirname(targetDbPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // If target database exists, remove main DB and auxiliary WAL/SHM files
  if (existsSync(targetDbPath)) unlinkSync(targetDbPath);
  if (existsSync(`${targetDbPath}-wal`)) unlinkSync(`${targetDbPath}-wal`);
  if (existsSync(`${targetDbPath}-shm`)) unlinkSync(`${targetDbPath}-shm`);

  // Restore via VACUUM INTO from backup
  const sourceDb = createDatabase({ path: backupPath, readonly: true });
  try {
    sourceDb.run("VACUUM INTO ?;", [targetDbPath]);
  } finally {
    sourceDb.close();
  }

  return { ok: true, schemaVersion: version };
}
