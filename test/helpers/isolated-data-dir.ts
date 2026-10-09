// test/helpers/isolated-data-dir.ts — Points X_FACTORY_DATA_DIR at a temp dir, so no test writes to ~/.x-factory.

import { beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let processDataDir: string | undefined;

/**
 * Call once at the top level of a test file, before any other top-level hook.
 *
 * Bun runs every test file in one process, and the runs module caches one
 * default database for that process, opened at the first data dir it sees. So
 * all files share one temp data dir for the whole run. It is not removed: an
 * exit listener changes bun's exit code under coverage, and removing the dir
 * from a file's afterAll breaks the cached database for later files.
 */
export function isolateDataDir(): void {
  beforeAll(() => {
    processDataDir ??= mkdtempSync(path.join(tmpdir(), "xf-test-data-"));
    process.env.X_FACTORY_DATA_DIR = processDataDir;
  });
}
