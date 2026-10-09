// test/composition-root.test.ts — one database connection per process (issue #169).
//
// The API process and the worker each open one connection, migrate it and hand
// one repository bundle down. These tests go through the public seams: the
// server, the worker, the process opener and a source scan of the import graph.

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openProcessDatabase } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { getDatabasePath } from "../src/paths.js";
import { startServer } from "../src/server.js";
import { Worker } from "../src/worker.js";

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

  it("the process opener gives a file database WAL mode and foreign keys on", () => {
    const filePath = path.join(dataDir, "opener", "composition.db");
    const db = openProcessDatabase({ path: filePath });
    try {
      expect(db.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({
        foreign_keys: 1,
      });
    } finally {
      db.close();
    }
  });

  it("the worker closes the connection it opened when it stops", async () => {
    const worker = new Worker({ workerId: "worker-owns-connection" });
    // The connection is private to the worker; reading it is the only way to
    // observe that stop() closed it.
    const { db } = worker as unknown as { db: Database };
    await worker.stop();
    expect(() => db.query("SELECT 1 AS one").get()).toThrow();
  });

  it("the worker leaves an injected connection open, since the caller owns it", async () => {
    const db = migratedDatabaseWithRun("run-worker-injected");
    const worker = new Worker({ workerId: "worker-injected", db });
    await worker.stop();
    expect(db.query("SELECT 1 AS one").get()).toEqual({ one: 1 });
    db.close();
  });
});

describe("composition root: no module-global database handle (#169)", () => {
  // Transpiled JS has types and comments stripped, so only runtime code matches.
  const srcDir = path.resolve(import.meta.dir, "..", "src");

  function importsBunSqlite(js: string): boolean {
    return new Bun.Transpiler({ loader: "ts" })
      .scanImports(js)
      .some((i) => i.path === "bun:sqlite");
  }

  function runtimeSource(file: string): string {
    const loader = file.endsWith(".tsx") ? "tsx" : "ts";
    const source = readFileSync(path.join(srcDir, file), "utf-8");
    return new Bun.Transpiler({ loader }).transformSync(source);
  }

  it("only the allowlisted modules open a connection or import bun:sqlite as a value", () => {
    const opensConnection: string[] = [];
    const importsSqliteValue: string[] = [];
    for (const file of new Bun.Glob("**/*.{ts,tsx}").scanSync(srcDir)) {
      const js = runtimeSource(file);
      if (/\bcreateDatabase\b|\bnew\s+Database\s*\(/.test(js))
        opensConnection.push(file);
      if (importsBunSqlite(js)) importsSqliteValue.push(file);
    }
    // The composition root is the only place that opens the process connection.
    // The server and the worker call its opener and so do not appear here.
    // Backup code opens snapshot files, not the process connection, and
    // connection.ts is the factory itself.
    expect(opensConnection.sort()).toEqual([
      "composition-root.ts",
      "db/backup.ts",
      "db/connection.ts",
    ]);
    expect(importsSqliteValue.sort()).toEqual(["db/connection.ts"]);
  });
});
