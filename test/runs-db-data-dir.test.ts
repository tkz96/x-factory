// test/runs-db-data-dir.test.ts — The process-wide default database follows
// the data directory that is current when it is used.
//
// Regression: getDb() used to open the database once and keep that handle for
// the life of the process. A suite that pointed X_FACTORY_DATA_DIR at its own
// temp directory and removed it afterwards left the next suite holding an
// unlinked database file (SQLITE_IOERR_VNODE). Module-level caches built on
// the handle (the worker heartbeat registry) must follow the switch too.
//
// The temp data dir stays set for the whole file, so getDb() can never
// resolve to a real ~/.x-factory during these tests.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getActiveWorkers,
  registerWorkerHeartbeat,
  resetWorkerRegistryForTesting,
} from "../src/diagnostics/worker-registry.js";
import { getRunRepository, resetDefaultDbForTesting } from "../src/runs.js";

const savedDataDir = process.env.X_FACTORY_DATA_DIR;
const savedDbPath = process.env.X_FACTORY_DB_PATH;

let currentDir: string | null = null;

/** Points the data dir at a fresh temp directory and removes the previous one. */
async function switchDataDir(): Promise<void> {
  const previous = currentDir;
  currentDir = await mkdtemp(path.join(tmpdir(), "xf-db-switch-"));
  process.env.X_FACTORY_DATA_DIR = currentDir;
  if (previous) await rm(previous, { recursive: true, force: true });
}

beforeAll(async () => {
  delete process.env.X_FACTORY_DB_PATH;
  await switchDataDir();
  resetWorkerRegistryForTesting();
});

afterAll(async () => {
  resetDefaultDbForTesting();
  if (currentDir) await rm(currentDir, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.X_FACTORY_DB_PATH;
  else process.env.X_FACTORY_DB_PATH = savedDbPath;
});

describe("default run database follows X_FACTORY_DATA_DIR", () => {
  it("keeps working after the data dir it was first opened in is removed", async () => {
    expect(getRunRepository().list()).toEqual([]);

    await switchDataDir();

    expect(() => getRunRepository().list()).not.toThrow();
    expect(getRunRepository().list()).toEqual([]);
    expect(existsSync(path.join(currentDir as string, "x-factory.db"))).toBe(
      true,
    );
  });

  it("worker registry writes land in the database of the current data dir", async () => {
    registerWorkerHeartbeat("worker-before-switch");
    expect(getActiveWorkers().map((w) => w.workerId)).toEqual([
      "worker-before-switch",
    ]);

    await switchDataDir();

    registerWorkerHeartbeat("worker-after-switch");
    expect(getActiveWorkers().map((w) => w.workerId)).toEqual([
      "worker-after-switch",
    ]);
  });
});
