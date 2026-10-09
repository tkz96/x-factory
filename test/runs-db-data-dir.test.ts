// test/runs-db-data-dir.test.ts — The process-wide default database follows
// the data directory that is current when it is used.
//
// Regression: getDb() used to open the database once and keep that handle for
// the life of the process. A suite that pointed X_FACTORY_DATA_DIR at its own
// temp directory and removed it afterwards left the next suite holding an
// unlinked database file (SQLITE_IOERR_VNODE).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getRunRepository } from "../src/runs.js";

const savedDataDir = process.env.X_FACTORY_DATA_DIR;
const savedDbPath = process.env.X_FACTORY_DB_PATH;

beforeEach(() => {
  delete process.env.X_FACTORY_DB_PATH;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.X_FACTORY_DB_PATH;
  else process.env.X_FACTORY_DB_PATH = savedDbPath;
});

describe("default run database follows X_FACTORY_DATA_DIR", () => {
  it("keeps working after the data dir it was first opened in is removed", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "xf-db-first-"));
    process.env.X_FACTORY_DATA_DIR = first;
    expect(getRunRepository().list()).toEqual([]);

    await rm(first, { recursive: true, force: true });

    const second = await mkdtemp(path.join(tmpdir(), "xf-db-second-"));
    try {
      process.env.X_FACTORY_DATA_DIR = second;
      expect(() => getRunRepository().list()).not.toThrow();
      expect(getRunRepository().list()).toEqual([]);
      expect(existsSync(path.join(second, "x-factory.db"))).toBe(true);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });
});
