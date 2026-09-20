// test/legacy-importer.test.ts — Unit tests for legacy run.json migration and artifact separation (XFM-10, XFM-11).

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { importLegacyRuns } from "../src/db/importer.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";

describe("Legacy run.json Migration & Artifact Separation (XFM-10, XFM-11)", () => {
  let db: Database;
  let testDataDir: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);

    testDataDir = path.join("/tmp", `xf-test-import-${Date.now()}`);
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    db.close();
    await rm(testDataDir, { recursive: true, force: true });
  });

  async function createLegacyRunFile(
    projectId: string,
    runId: string,
    content: string,
  ) {
    const runDir = path.join(testDataDir, "projects", projectId, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "run.json"), content, "utf-8");
    // Also create dummy artifact files to verify artifact separation (XFM-11)
    await writeFile(
      path.join(runDir, "plan.md"),
      "# Big Plan File\nVery long text",
      "utf-8",
    );
    await writeFile(
      path.join(runDir, "diff.patch"),
      "diff --git a/file b/file",
      "utf-8",
    );
    return runDir;
  }

  it("successfully imports valid legacy run.json into SQLite", async () => {
    const validJson = JSON.stringify({
      id: "run-legacy-1",
      project: { id: "proj-alpha", name: "Project Alpha" },
      ticket: {
        id: "TICK-101",
        title: "Legacy Feature",
        description: "Migrated from disk",
        acceptanceCriteria: ["AC 1", "AC 2"],
      },
      plan: "Original plan",
      branch: "feature/legacy-1",
      status: "verifying",
      repairAttempts: 1,
    });

    const runDir = await createLegacyRunFile(
      "proj-alpha",
      "run-legacy-1",
      validJson,
    );

    const report = await importLegacyRuns(db, { dataDir: testDataDir });
    expect(report.totalScanned).toBe(1);
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);

    // Verify imported record in SQLite
    const repo = new RunRepository(db);
    const importedRun = repo.get("run-legacy-1");
    expect(importedRun).not.toBeNull();
    expect(importedRun?.project.id).toBe("proj-alpha");
    expect(importedRun?.ticket.id).toBe("TICK-101");
    expect(importedRun?.status).toBe("verifying");
    expect(importedRun?.artifactsDir).toBe(runDir);
    expect(importedRun?.revision).toBe(1);
  });

  it("is idempotent: re-running does not duplicate and reports skipped", async () => {
    const validJson = JSON.stringify({
      id: "run-idempotent",
      project: { id: "proj-beta", name: "Project Beta" },
      ticket: {
        id: "TICK-202",
        title: "Idempotent Run",
        acceptanceCriteria: [],
      },
      status: "ready_for_pr",
    });

    await createLegacyRunFile("proj-beta", "run-idempotent", validJson);

    // First run: imports 1
    const rep1 = await importLegacyRuns(db, { dataDir: testDataDir });
    expect(rep1.imported).toBe(1);

    // Second run: skips 1
    const rep2 = await importLegacyRuns(db, { dataDir: testDataDir });
    expect(rep2.imported).toBe(0);
    expect(rep2.skipped).toBe(1);
    expect(rep2.details[0]?.status).toBe("skipped");
    expect(rep2.details[0]?.reason).toContain("already exists");
  });

  it("gracefully skips corrupt and malformed run.json files with error reports", async () => {
    // 1. Completely invalid JSON syntax
    await createLegacyRunFile(
      "proj-gamma",
      "run-corrupt-1",
      "{ invalid json syntax ... ",
    );

    // 2. Missing required fields (no project and no ticket)
    await createLegacyRunFile(
      "proj-gamma",
      "run-incomplete-2",
      JSON.stringify({ id: "incomplete-run", status: "preparing" }),
    );

    const report = await importLegacyRuns(db, { dataDir: testDataDir });
    expect(report.totalScanned).toBe(2);
    expect(report.imported).toBe(0);
    expect(report.errors).toBe(2);
    expect(
      report.details.some(
        (d) => d.runId === "run-corrupt-1" && d.status === "error",
      ),
    ).toBe(true);
    expect(
      report.details.some(
        (d) => d.runId === "run-incomplete-2" && d.status === "error",
      ),
    ).toBe(true);
  });

  it("enforces artifact separation: SQLite stores references only (XFM-11)", async () => {
    const validJson = JSON.stringify({
      id: "run-artifact-sep",
      project: { id: "proj-delta", name: "Project Delta" },
      ticket: {
        id: "TICK-303",
        title: "Artifact Separation",
        acceptanceCriteria: [],
      },
      status: "implementing",
    });

    const runDir = await createLegacyRunFile(
      "proj-delta",
      "run-artifact-sep",
      validJson,
    );
    await importLegacyRuns(db, { dataDir: testDataDir });

    const repo = new RunRepository(db);
    const run = repo.get("run-artifact-sep");

    // SQLite only contains path pointer to artifacts directory
    expect(run?.artifactsDir).toBe(runDir);

    // Raw artifact files (plan.md, diff.patch) were not dumped into runs table columns
    const rawRow = db
      .prepare("SELECT * FROM runs WHERE id = 'run-artifact-sep'")
      .get() as Record<string, unknown>;
    expect(rawRow.diff).toBeNull();
    expect(typeof rawRow.plan).toBe("string");
    expect((rawRow.plan as string).includes("Very long text")).toBe(false);
  });
});
