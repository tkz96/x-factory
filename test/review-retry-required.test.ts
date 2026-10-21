// test/review-retry-required.test.ts — The run that waits after its review used up its model
// attempts (review_retry_required): the transitions into and out of it, its Retry review action
// over HTTP, and that it holds no live work.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { handleApi } from "../src/http/routes.js";
import { abandonRun, retryReview, stopRun } from "../src/runs.js";
import {
  canRunAction,
  canTransition,
  NON_LIVE_RUN_STATUSES,
} from "../src/shared/run-status-policy.js";
import type { RunStatus } from "../src/shared/types.js";

function setup(status: RunStatus): {
  repos: Repositories;
  runId: string;
  worktree: string;
} {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  const worktree = mkdtempSync(path.join(tmpdir(), "xf-retry-required-"));
  const runId = `run-retry-${status}`;
  repos.runs.create({
    id: runId,
    projectId: "proj-retry",
    projectName: "Retry Review",
    ticket: { id: "R-1", title: "Retry", acceptanceCriteria: [] },
    plan: "1. Change app",
    branch: "factory/r-1",
    status,
    artifactsDir: path.join(worktree, "artifacts"),
    worktreePath: worktree,
  });
  return { repos, runId, worktree };
}

function post(urlPath: string): Request {
  return new Request(`http://localhost:3777${urlPath}`, { method: "POST" });
}

describe("review_retry_required: transitions", () => {
  it("is reached from executing, the only way a spent review attempt leaves coding", () => {
    expect(canTransition("executing", "review_retry_required")).toBe(true);
    expect(canTransition("awaiting_review", "review_retry_required")).toBe(
      false,
    );
  });

  it("leads back to executing (Retry review), failed (abandon) and stopped only", () => {
    expect(canTransition("review_retry_required", "executing")).toBe(true);
    expect(canTransition("review_retry_required", "failed")).toBe(true);
    expect(canTransition("review_retry_required", "stopped")).toBe(true);
    expect(canTransition("review_retry_required", "awaiting_review")).toBe(
      false,
    );
    expect(canTransition("review_retry_required", "pr_created")).toBe(false);
  });

  it("holds no live work, so the startup sweep leaves it alone", () => {
    expect(NON_LIVE_RUN_STATUSES.has("review_retry_required")).toBe(true);
  });
});

describe("review_retry_required: Retry review", () => {
  it("moves the run back to executing and enqueues one review job, not a coding job", () => {
    const { repos, runId } = setup("review_retry_required");

    const run = retryReview(repos, runId);

    expect(run.status).toBe("executing");
    const jobs = repos.jobs.listJobsForRun(runId);
    expect(jobs.map((j) => [j.stage, j.status])).toEqual([
      ["review", "pending"],
    ]);
  });

  it("is refused in any other status, with a conflict", () => {
    const { repos, runId } = setup("awaiting_review");
    expect(() => retryReview(repos, runId)).toThrow(
      /cannot|not allowed|Cannot/i,
    );
    expect(repos.runs.get(runId)?.status).toBe("awaiting_review");
    expect(canRunAction("awaiting_review", "retry_review")).toBe(false);
  });

  it("over HTTP answers 200 with the run in executing, and 409 in any other status", async () => {
    const { repos, runId } = setup("review_retry_required");
    const ok = await handleApi(
      post(`/api/runs/${runId}/retry-review`),
      new URL(`http://localhost:3777/api/runs/${runId}/retry-review`),
      { repos },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).run.status).toBe("executing");

    const other = setup("awaiting_review");
    const refused = await handleApi(
      post(`/api/runs/${other.runId}/retry-review`),
      new URL(`http://localhost:3777/api/runs/${other.runId}/retry-review`),
      { repos: other.repos },
    );
    expect(refused.status).toBe(409);
  });
});

describe("review_retry_required: the other ways out", () => {
  it("abandon ends the run as failed and keeps the worktree on disk", async () => {
    const { repos, runId, worktree } = setup("review_retry_required");

    const run = await abandonRun(repos, runId, "no longer needed");

    expect(run.status).toBe("failed");
    expect(existsSync(worktree)).toBe(true);
  });

  it("stop ends the run as stopped", async () => {
    const { repos, runId } = setup("review_retry_required");

    await stopRun(repos, runId);

    expect(repos.runs.get(runId)?.status).toBe("stopped");
  });
});
