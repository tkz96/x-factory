// test/composition-root.test.ts — one database connection per process (issue #169).
//
// The API process opens one connection, migrates it and hands it to the HTTP
// surface. These tests go through the public server seam: a custom database
// passed to startServer is the one requests read, and shutdown closes it.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { getDatabasePath } from "../src/paths.js";
import { startServer } from "../src/server.js";

const previousDataDir = process.env.X_FACTORY_DATA_DIR;
const dataDir = mkdtempSync(path.join(tmpdir(), "composition-root-"));

beforeAll(() => {
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function migratedDatabaseWithRun(runId: string) {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  new RunRepository(db).create({
    id: runId,
    projectId: "p-composition",
    projectName: "Composition",
    ticket: { id: "T-1", title: "Composition ticket", acceptanceCriteria: [] },
    plan: "plan",
    branch: "factory/t-1",
    status: "executing",
    artifactsDir: "/tmp/composition-artifacts",
    worktreePath: "/tmp/composition-worktree",
  });
  return db;
}

describe("composition root: one connection per process (#169)", () => {
  it("requests are served by the connection the server opened", async () => {
    const db = migratedDatabaseWithRun("run-on-custom-db");
    const server = startServer(0, undefined, db);
    try {
      const res = await fetch(
        `http://localhost:${server.port}/api/runs/run-on-custom-db`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string };
      expect(body.id).toBe("run-on-custom-db");
      expect(body.status).toBe("executing");
    } finally {
      await server.shutdown();
    }
  });

  it("shutdown closes the connection that served requests", async () => {
    const db = migratedDatabaseWithRun("run-closed-on-shutdown");
    const server = startServer(0, undefined, db);
    await fetch(`http://localhost:${server.port}/api/runs`);
    await server.shutdown();
    expect(() => db.query("SELECT 1 AS one").get()).toThrow();
  });

  it("migrates the server's connection once and opens no second database", async () => {
    const db = createDatabase({ path: ":memory:" });
    const server = startServer(0, undefined, db);
    try {
      const res = await fetch(`http://localhost:${server.port}/api/runs`);
      expect(res.status).toBe(200);
      expect(runMigrations(db).applied).toBe(0);
      expect(existsSync(getDatabasePath())).toBe(false);
    } finally {
      await server.shutdown();
    }
  });
});

describe("composition root: no module-global database handle (#169)", () => {
  it("only the composition entry points open a database connection", () => {
    const srcDir = path.resolve(import.meta.dir, "..", "src");
    const openers: string[] = [];
    for (const file of new Bun.Glob("**/*.ts").scanSync(srcDir)) {
      const source = readFileSync(path.join(srcDir, file), "utf-8");
      if (/(?<!function )\bcreateDatabase\(/.test(source)) openers.push(file);
    }
    // The API and the worker each open their one connection. Backup code opens
    // separate snapshot files, not the process's connection.
    expect(openers.sort()).toEqual(["db/backup.ts", "server.ts", "worker.ts"]);
  });
});
