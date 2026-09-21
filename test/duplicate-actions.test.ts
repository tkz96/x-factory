import { afterAll, describe, expect, it } from "bun:test";
import {
  type PiAgentSession,
  registerActiveSession,
} from "../src/agents/pi.js";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";
import { Worker } from "../src/worker.js";

describe("Duplicate-Action Idempotency (XFM-62)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
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
      status: "implementing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    // 1. First Stop Call
    const req1 = new Request(`http://localhost/api/runs/${runId}/stop`, {
      method: "POST",
    });
    const res1 = await handleApi(req1, new URL(req1.url));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean };
    expect(body1.ok).toBe(true);

    const runAfterFirstStop = runRepo.get(runId);
    expect(runAfterFirstStop?.status).toBe("stopped");

    // 2. Second Stop Call (Double Click)
    const req2 = new Request(`http://localhost/api/runs/${runId}/stop`, {
      method: "POST",
    });
    const res2 = await handleApi(req2, new URL(req2.url));
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
    const req1 = new Request(`http://localhost/api/runs/${runId}/pr`, {
      method: "POST",
    });
    const res1 = await handleApi(req1, new URL(req1.url));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as typeof prPayload;
    expect(body1.url).toBe(prPayload.url);

    // Second PR call (Double Click)
    const req2 = new Request(`http://localhost/api/runs/${runId}/pr`, {
      method: "POST",
    });
    const res2 = await handleApi(req2, new URL(req2.url));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as typeof prPayload;
    expect(body2.url).toBe(prPayload.url);
  });

  it("steer deduplication ignores duplicate command_id submissions", async () => {
    const { db, runRepo } = setupTest();

    const runId = `run-steer-${Date.now()}`;
    const run = runRepo.create({
      id: runId,
      projectId: "proj-steer",
      projectName: "Steer Project",
      ticket: { id: "STEER-1", title: "Steer Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/steer-1",
      status: "implementing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    let piSteerCallCount = 0;
    const mockSession = {
      steer: async (_msg: string) => {
        piSteerCallCount++;
      },
      abort: async () => {},
    };

    registerActiveSession(run.id, mockSession as unknown as PiAgentSession);

    const commandRepo = new CommandRepository(db);
    const worker = new Worker({ db, workerId: "worker-steer-test" });

    const commandId = `cmd-${Date.now()}-abc`;

    // 1. First Steer
    const req1 = new Request(`http://localhost/api/runs/${runId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Refactor function X",
        commandId,
      }),
    });
    const res1 = await handleApi(req1, new URL(req1.url));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean; deduplicated: boolean };
    expect(body1.ok).toBe(true);
    expect(body1.deduplicated).toBe(false);

    // Worker processes first command
    const commands1 = commandRepo.claimPendingCommands(
      "worker-steer-test",
      30000,
    );
    for (const cmd of commands1) {
      await worker.processCommand(cmd);
    }
    expect(piSteerCallCount).toBe(1);

    // 2. Second Steer with SAME commandId (or command_id)
    const req2 = new Request(`http://localhost/api/runs/${runId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Refactor function X",
        command_id: commandId,
      }),
    });
    const res2 = await handleApi(req2, new URL(req2.url));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; deduplicated: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.deduplicated).toBe(true);

    // No new commands queued; Pi session steer must NOT have been called a second time
    const commands2 = commandRepo.claimPendingCommands(
      "worker-steer-test",
      30000,
    );
    expect(commands2.length).toBe(0);
    expect(piSteerCallCount).toBe(1);
  });
});
