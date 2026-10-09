// test/errors-by-family.test.ts — Domain errors map to HTTP by family (#168).
//
// The HTTP API seam: `handleApi` over an in-memory SQLite database for the
// reachable action guards, and the `catchHttpErrors` wrapper that every
// controller runs its action through, fed the real repository errors whose
// races (stale revision, illegal transition) cannot be interleaved
// deterministically inside a single-threaded request transaction.

import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import {
  IllegalStateTransitionError,
  RunNotFoundError,
  type RunRecord,
  RunRepository,
  StaleRevisionError,
} from "../src/db/run-repository.js";
import { catchHttpErrors } from "../src/http/responses.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";
import type { RunStatus } from "../src/shared/types.js";

let db: Database | undefined;

afterAll(() => {
  setDbForTesting(null);
  db?.close();
});

// setDbForTesting stores the database in an AsyncLocalStorage context, so it
// must be called from the test body, not from beforeAll.
function setupTestDb(): RunRepository {
  db?.close();
  db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  setDbForTesting(db);
  return new RunRepository(db);
}

function createRunAtStatus(
  runRepo: RunRepository,
  id: string,
  status: RunStatus,
): RunRecord {
  return runRepo.create({
    id,
    projectId: "proj-family",
    projectName: "Family Test Project",
    ticket: {
      id: "FAM-1",
      title: "Family mapping",
      acceptanceCriteria: ["Illegal actions are conflicts, not crashes"],
    },
    plan: "Step 1",
    branch: `factory/fam-${id}`,
    status,
    artifactsDir: `/tmp/artifacts/${id}`,
    worktreePath: `/tmp/worktrees/${id}`,
  });
}

function postJson(pathname: string, body?: unknown): Promise<Response> {
  const req = new Request(`http://localhost${pathname}`, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  return handleApi(req, new URL(req.url));
}

function transitionRequest(runId: string, action: string): Promise<Response> {
  return postJson(`/api/runs/${runId}/transitions`, { action });
}

describe("Domain errors map to HTTP by family (#168)", () => {
  it("a missing run returns 404 through the HTTP API", async () => {
    setupTestDb();
    const res = await transitionRequest("run-missing-404", "approve");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Run run-missing-404 not found.",
    });
  });

  it("a RunNotFoundError — a NotFound family member with its own name — translates to 404", async () => {
    const res = await catchHttpErrors(async () => {
      throw new RunNotFoundError("run-repo-missing");
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Run "run-repo-missing" not found.',
    });
  });

  it("a stale revision returns 409 with the repository's conflict message", async () => {
    const res = await catchHttpErrors(async () => {
      throw new StaleRevisionError("run-stale", 3, 5);
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'Conflict: Run "run-stale" revision 5 does not match expected revision 3.',
    });
  });

  it("an illegal state transition returns 409 with the repository's conflict message", async () => {
    const res = await catchHttpErrors(async () => {
      throw new IllegalStateTransitionError("pr_created", "queued");
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Illegal run state transition from 'pr_created' to 'queued'.",
    });
  });

  it("approve in a disallowed status returns 409 with a clear message", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-approve-conflict", "executing");
    const res = await transitionRequest("run-approve-conflict", "approve");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Cannot approve in status "executing".',
    });
  });

  it("restart in a disallowed status returns 409 with a clear message", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-restart-conflict", "awaiting_review");
    const res = await transitionRequest("run-restart-conflict", "restart");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Cannot restart in status "awaiting_review".',
    });
  });

  it("requeue in a disallowed status returns 409 with a clear message", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-requeue-conflict", "queued");
    const res = await transitionRequest("run-requeue-conflict", "requeue");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Cannot requeue in status "queued".',
    });
  });

  it("steer in a disallowed status returns 409 with a clear message", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-steer-conflict", "queued");
    const res = await postJson("/api/runs/run-steer-conflict/steer", {
      message: "Focus on auth.ts",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Cannot steer in status "queued".',
    });
  });

  it("chat outside the approval gates returns 409 with a clear message", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-chat-conflict", "queued");
    const res = await postJson("/api/runs/run-chat-conflict/chat", {
      message: "Hello",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'Chat is only available during approval gates. Current status: "queued".',
    });
  });
});
