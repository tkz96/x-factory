// test/diagnostics-http-counts.test.ts — HTTP seam for run and job counts (#188).
// Locks the exact active, terminal and schema-version values the diagnostics
// endpoint reports, so the repository refactor cannot change them silently.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { resetWorkerRegistryForTesting } from "../src/diagnostics/worker-registry.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

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

describe("GET /api/diagnostics counts over HTTP (#188)", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    resetWorkerRegistryForTesting();
    db = createDatabase({ path: ":memory:" });
    runMigrations(db);
  });

  afterEach(() => {
    setDbForTesting(null);
    resetWorkerRegistryForTesting();
    db.close();
  });

  it("reports exact active and terminal run counts, job counts and the schema version", async () => {
    const runs = new RunRepository(db);
    seedRun(runs, "r-preparing", "preparing");
    seedRun(runs, "r-awaiting", "awaiting_plan_approval");
    seedRun(runs, "r-recovery", "recovery_required");
    seedRun(runs, "r-pr", "pr_created");
    seedRun(runs, "r-failed", "failed");
    seedRun(runs, "r-stopped", "stopped");

    const jobs = new JobRepository(db);
    jobs.createJob({
      runId: "r-preparing",
      stage: "prepare",
      status: "completed",
    });
    jobs.createJob({ runId: "r-awaiting", stage: "plan", status: "pending" });
    jobs.createJob({ runId: "r-recovery", stage: "execute", status: "failed" });

    // Bind the database in the same async context as the request (as diagnostics-api.test.ts does).
    setDbForTesting(db);
    const req = new Request("http://localhost:3777/api/diagnostics");
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      database: {
        version: number;
        runs: { total: number; active: number };
        jobs: {
          total: number;
          pending: number;
          claimed: number;
          completed: number;
          failed: number;
        };
      };
    };

    expect(body.database.version).toBe(9);
    expect(body.database.runs).toEqual({ total: 6, active: 3 });
    expect(body.database.jobs).toEqual(
      expect.objectContaining({
        total: 3,
        pending: 1,
        claimed: 0,
        completed: 1,
        failed: 1,
      }),
    );
  });
});
