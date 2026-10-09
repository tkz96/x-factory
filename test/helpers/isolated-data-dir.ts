// test/helpers/isolated-data-dir.ts — Gives one test file its own X_FACTORY_DATA_DIR, so no test writes to ~/.x-factory.

import { beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const createdDirs: string[] = [];

// Bun runs every test file in one process, and a database opened in one file's
// data dir can outlive that file (the runs module caches its connection). The
// dirs are therefore removed when the process exits, not after each file.
process.once("exit", () => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Call once at the top level of a test file, before any other top-level hook.
 * Points X_FACTORY_DATA_DIR at a fresh temp directory for that file, so
 * settings, the database, locks and projects stay out of the real home directory.
 */
export function isolateDataDir(): void {
  beforeAll(() => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "xf-test-data-"));
    createdDirs.push(dataDir);
    process.env.X_FACTORY_DATA_DIR = dataDir;
  });
}
