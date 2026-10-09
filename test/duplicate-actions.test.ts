import { afterAll, describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleApi } from "../src/http/routes.js";

let repos: Repositories;

describe("Duplicate-Action Idempotency (XFM-62)", () => {
  afterAll(() => {});

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    repos = createRepositories(db);
    const runRepo = new RunRepository(db);

    return { db, runRepo };
  }

  it("double-click stop is idempotent and returns HTTP 200 on repeated calls", async () => {
    const { runRepo } = setupTest();

    const runId = `run-stop-${Date.now()}`;
    runRepo.create({
      id: runId,
      projectId: "proj-stop",
      projectName: "Stop Project",
      ticket: { id: "STOP-1", title: "Stop Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/stop-1",
      status: "executing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    // 1. First Stop Call
    const req1 = new Request(`http://localhost:3777/api/runs/${runId}/stop`, {
      method: "POST",
    });
    const res1 = await handleApi(req1, new URL(req1.url), { repos });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean };
    expect(body1.ok).toBe(true);

    const runAfterFirstStop = runRepo.get(runId);
    expect(runAfterFirstStop?.status).toBe("stopped");

    // 2. Second Stop Call (Double Click)
    const req2 = new Request(`http://localhost:3777/api/runs/${runId}/stop`, {
      method: "POST",
    });
    const res2 = await handleApi(req2, new URL(req2.url), { repos });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean };
    expect(body2.ok).toBe(true);

    const runAfterSecondStop = runRepo.get(runId);
    expect(runAfterSecondStop?.status).toBe("stopped");
  });

  it("double PR creation idempotently returns existing pull request without error", async () => {
    const { runRepo } = setupTest();

    const runId = `run-pr-${Date.now()}`;
    const prPayload = {
      url: "https://github.com/org/repo/pull/42",
      branch: "factory/pr-42",
      baseBranch: "main",
      title: "[X-Factory] PR 42: Double PR Test",
    };

    runRepo.create({
      id: runId,
      projectId: "proj-pr",
      projectName: "PR Project",
      ticket: { id: "PR-1", title: "Double PR Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/pr-42",
      status: "ready_for_pr",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    runRepo.update(runId, {
      pullRequest: prPayload,
    });

    // First PR call
    const req1 = new Request(`http://localhost:3777/api/runs/${runId}/pr`, {
      method: "POST",
    });
    const res1 = await handleApi(req1, new URL(req1.url), { repos });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as typeof prPayload;
    expect(body1.url).toBe(prPayload.url);

    // Second PR call (Double Click)
    const req2 = new Request(`http://localhost:3777/api/runs/${runId}/pr`, {
      method: "POST",
    });
    const res2 = await handleApi(req2, new URL(req2.url), { repos });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as typeof prPayload;
    expect(body2.url).toBe(prPayload.url);
  });
});
