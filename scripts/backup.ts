#!/usr/bin/env bun
// scripts/backup.ts — CLI backup script for SQLite database and filesystem artifacts (XFM-72).

import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDatabase } from "../src/db/backup.js";
import { createDatabase } from "../src/db/connection.js";
import { getDbPath } from "../src/paths.js";

async function main() {
  const defaultBackupDir = path.join(os.homedir(), ".x-factory", "backups");
  const targetDir = process.env.BACKUP_DIR || defaultBackupDir;

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_");
  const backupDbPath = path.join(targetDir, `x-factory-db-${timestamp}.db`);

  console.log(`[Backup] Connecting to live SQLite database (${getDbPath()})…`);
  const liveDb = createDatabase();

  try {
    console.log(`[Backup] Executing live atomic snapshot to ${backupDbPath}…`);
    const result = await backupDatabase(liveDb, backupDbPath);

    console.log(`[Backup] Database backup complete and verified!`);
    console.log(`  - Destination: ${result.backupPath}`);
    console.log(
      `  - Size: ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB (${result.sizeBytes} bytes)`,
    );
    console.log(`  - Schema Version: ${result.schemaVersion}`);
    console.log(`  - Integrity: ${result.integrity}`);
    console.log(
      `  - Contents: ${result.stats.runs} runs, ${result.stats.jobs} jobs, ${result.stats.events} events`,
    );

    // Artifact filesystem backup guidance
    const artifactsDir = path.join(os.homedir(), ".x-factory", "artifacts");
    const artifactsTarPath = path.join(
      targetDir,
      `x-factory-artifacts-${timestamp}.tar.gz`,
    );

    if (existsSync(artifactsDir)) {
      console.log(
        `[Backup] Archiving artifacts from ${artifactsDir} to ${artifactsTarPath}…`,
      );
      const tarProc = Bun.spawn([
        "tar",
        "-czf",
        artifactsTarPath,
        "-C",
        path.dirname(artifactsDir),
        path.basename(artifactsDir),
      ]);
      await tarProc.exited;
      console.log(`[Backup] Artifacts archive complete: ${artifactsTarPath}`);
    } else {
      console.log(
        `[Backup] Artifacts directory (${artifactsDir}) not found; skipped.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: result,
          backupDirectory: targetDir,
        },
        null,
        2,
      ),
    );
  } finally {
    liveDb.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[Backup Error]:", err);
    process.exit(1);
  });
}
