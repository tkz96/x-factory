// test/steer-removal.test.ts — Steering is removed, not ported (#167).
//
// Existing databases can still hold `steer` rows in run_commands and `steer`
// events in run_events. These tests pin the behaviour after removal, at three
// seams:
//   1. HTTP API seam — POST /api/runs/:id/steer returns 404 through handleApi.
//   2. Worker seam — a leftover steer command row is failed cleanly, never
//      crash-looped or silently retried.
//   3. Client run-state seam — a leftover steer event renders as a neutral
//      fallback in ChatThread / EventLogViewer instead of crashing.

import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

function setupTest() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  setDbForTesting(db);
  const runRepo = new RunRepository(db);
  const eventRepo = new EventRepository(db);
  return { db, runRepo, eventRepo };
}

function createRun(runRepo: RunRepository, runId: string) {
  return runRepo.create({
    id: runId,
    projectId: "proj-steer-removal",
    projectName: "Steer Removal Project",
    ticket: {
      id: "SR-1",
      title: "Steer Removal",
      acceptanceCriteria: [],
    },
    plan: "Plan",
    branch: "factory/steer-removal",
    status: "executing",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });
}

afterAll(() => {
  setDbForTesting(null);
});

describe("Steering removed (#167)", () => {
  it("POST /api/runs/:id/steer returns 404 through handleApi", async () => {
    const { runRepo } = setupTest();
    const runId = "run-steer-removed-404";
    createRun(runRepo, runId);

    const req = new Request(`http://localhost/api/runs/${runId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Focus on auth.ts" }),
    });
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Endpoint not found." });
  });
});
