// test/diagnostics-repository.test.ts — Regression tests for #188: diagnostics
// counts come from DiagnosticsRepository, which builds status filters from the
// shared run-status policy.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { DiagnosticsRepository } from "../src/db/diagnostics-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";

function seedRun(repo: RunRepository, id: string, status: string): void {
  repo.create({
    id,
    projectId: "p1",
    projectName: "Proj 1",
    ticket: { id: `T-${id}`, title: "Ticket", acceptanceCriteria: [] },
    plan: "plan",
    branch: `factory/${id}`,
    status: status as never,
    artifactsDir: `/tmp/a-${id}`,
    worktreePath: `/tmp/w-${id}`,
  });
}

describe("DiagnosticsRepository (#188)", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase({ path: ":memory:" });
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("counts all runs and the non-terminal ones, using the shared policy", () => {
    const runs = new RunRepository(db);
    seedRun(runs, "r-exec", "executing");
    seedRun(runs, "r-recovery", "recovery_required");
    seedRun(runs, "r-pr", "pr_created");
    seedRun(runs, "r-failed", "failed");
    seedRun(runs, "r-stopped", "stopped");

    const diagnostics = new DiagnosticsRepository(db);
    expect(diagnostics.countRuns()).toEqual({ total: 5, active: 2 });
  });

  it("counts jobs by status", () => {
    const runs = new RunRepository(db);
    seedRun(runs, "r1", "executing");
    const jobs = new JobRepository(db);
    jobs.createJob({ runId: "r1", stage: "prepare", status: "completed" });
    jobs.createJob({ runId: "r1", stage: "execute", status: "pending" });
    jobs.createJob({ runId: "r1", stage: "review", status: "failed" });

    const diagnostics = new DiagnosticsRepository(db);
    expect(diagnostics.countJobs()).toEqual({
      total: 3,
      pending: 1,
      claimed: 0,
      completed: 1,
      failed: 1,
    });
  });

  it("reports an empty database as zero counts", () => {
    const diagnostics = new DiagnosticsRepository(db);
    expect(diagnostics.countRuns()).toEqual({ total: 0, active: 0 });
    expect(diagnostics.countJobs()).toEqual({
      total: 0,
      pending: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
    });
  });
});
