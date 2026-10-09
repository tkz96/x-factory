// test/errors-by-family.test.ts — Domain errors map to HTTP by family (#168).
//
// The HTTP API seam: `handleApi` over an in-memory SQLite database. The two
// repository races (stale revision, illegal transition) are forced with TEMP
// triggers so the real errors are raised inside the request. `catchHttpErrors`
// is used directly only to show a NotFound family member with its own class
// name still maps to 404.

import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import {
  RunNotFoundError,
  type RunRecord,
  RunRepository,
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

const STALE_REVISION_MESSAGE =
  'Conflict: Run "run-stale" revision 2 does not match expected revision 1.';
const ILLEGAL_TRANSITION_MESSAGE =
  "Illegal run state transition from 'failed' to 'planning'.";

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

  // The two races below are made deterministic with SQLite TEMP triggers on the
  // in-memory database, so the request goes through handleApi → handleTransition
  // → transitionRun and the real repository error is raised mid-request.

  it("a stale revision returns 409 through the HTTP API", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-stale", "awaiting_plan_approval");
    // Swallow the status write, so transitionRun's compare-and-swap matches no
    // row and reports the revision it found instead.
    db?.run(
      "CREATE TEMP TRIGGER stale_revision BEFORE UPDATE OF status ON runs BEGIN SELECT RAISE(IGNORE); END",
    );
    const res = await transitionRequest("run-stale", "approve");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: STALE_REVISION_MESSAGE,
    });
  });

  it("an illegal state transition returns 409 through the HTTP API", async () => {
    const runRepo = setupTestDb();
    createRunAtStatus(runRepo, "run-illegal", "awaiting_review");
    // Requeue first rewrites the plan; flip the run to failed at that moment, so
    // the following transition to planning is illegal from the status it finds.
    db?.run(
      "CREATE TEMP TRIGGER illegal_transition AFTER UPDATE OF plan ON runs BEGIN UPDATE runs SET status = 'failed' WHERE id = NEW.id; END",
    );
    const res = await transitionRequest("run-illegal", "requeue");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: ILLEGAL_TRANSITION_MESSAGE,
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
