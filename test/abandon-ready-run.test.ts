// test/abandon-ready-run.test.ts — A ready run (ready_for_pr, reviewed and waiting for its pull request)
// can be abandoned: it ends as failed, and its branch and worktree stay on disk (Finding 8).

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
import { checkpointBarEntries } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { runStatusUi } from "../src/frontend/lib/run-status-ui.js";
import { handleApi } from "../src/http/routes.js";
import { abandonRun } from "../src/runs.js";
import { canRunAction } from "../src/shared/run-status-policy.js";

function setupReadyRun(): {
  repos: Repositories;
  runId: string;
  worktree: string;
} {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  const worktree = mkdtempSync(path.join(tmpdir(), "xf-ready-abandon-"));
  const runId = "run-ready-abandon";
  repos.runs.create({
    id: runId,
    projectId: "proj-ready",
    projectName: "Ready",
    ticket: { id: "RD-1", title: "Ready", acceptanceCriteria: [] },
    plan: "1. Change app",
    branch: "factory/rd-1",
    status: "ready_for_pr",
    artifactsDir: path.join(worktree, "artifacts"),
    worktreePath: worktree,
  });
  return { repos, runId, worktree };
}

describe("abandoning a ready run", () => {
  it("ends the run as failed and keeps the branch's worktree on disk", async () => {
    const { repos, runId, worktree } = setupReadyRun();

    const run = await abandonRun(repos, runId, "not needed after all");

    expect(run.status).toBe("failed");
    expect(repos.runs.get(runId)?.status).toBe("failed");
    expect(existsSync(worktree)).toBe(true);
  });

  it("is allowed by the shared policy, and stop is still not allowed on a ready run", () => {
    expect(canRunAction("ready_for_pr", "abandon")).toBe(true);
    expect(canRunAction("ready_for_pr", "stop")).toBe(false);
  });

  it("over HTTP answers 200 and the run is failed", async () => {
    const { repos, runId } = setupReadyRun();
    const url = `http://localhost:3777/api/runs/${runId}/abandon`;
    const res = await handleApi(
      new Request(url, { method: "POST" }),
      new URL(url),
      { repos },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("failed");
  });

  it("the run page offers Abandon Run beside Deliver for a ready run", () => {
    expect(checkpointBarEntries("ready_for_pr").map((e) => e.action)).toEqual([
      "deliver",
      "abandon",
    ]);
    expect(runStatusUi("ready_for_pr").actions.map((a) => a.label)).toContain(
      "Abandon Run",
    );
  });
});
