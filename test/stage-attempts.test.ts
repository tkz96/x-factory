// test/stage-attempts.test.ts — Unit tests for StageAttemptRepository (XFM-29).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";

describe("StageAttemptRepository (XFM-29)", () => {
  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    const run = runRepo.create({
      id: "run-att-1",
      projectId: "proj-att",
      projectName: "Attempt Project",
      ticket: {
        id: "ATT-1",
        title: "Stage Attempt Ticket",
        acceptanceCriteria: ["Durable logging"],
      },
      plan: "Test Plan",
      branch: "factory/ATT-1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts-att",
      worktreePath: "/tmp/worktrees-att",
    });

    return { db, runRepo, stageAttemptRepo, run };
  }

  it("records the start of a stage attempt with running status", () => {
    const { stageAttemptRepo, run } = setup();

    const attempt = stageAttemptRepo.recordStart(run.id, "prepare", 1);
    expect(attempt.id).toBeDefined();
    expect(attempt.runId).toBe(run.id);
    expect(attempt.stage).toBe("prepare");
    expect(attempt.attempt).toBe(1);
    expect(attempt.status).toBe("running");
    expect(attempt.startedAt).toBeDefined();
    expect(attempt.finishedAt).toBeNull();
    expect(attempt.output).toBeNull();
    expect(attempt.error).toBeNull();
  });

  it("auto-increments attempt number when omitted", () => {
    const { stageAttemptRepo, run } = setup();

    const att1 = stageAttemptRepo.recordStart(run.id, "implement");
    expect(att1.attempt).toBe(1);
    stageAttemptRepo.recordCompletion(att1.id, { result: "first" });

    const att2 = stageAttemptRepo.recordStart(run.id, "implement");
    expect(att2.attempt).toBe(2);
  });

  it("records stage attempt completion with output", () => {
    const { stageAttemptRepo, run } = setup();

    const attempt = stageAttemptRepo.recordStart(run.id, "understand", 1);
    const completed = stageAttemptRepo.recordCompletion(attempt.id, {
      relevantFilesCount: 3,
      constraintsCount: 2,
    });

    expect(completed.id).toBe(attempt.id);
    expect(completed.status).toBe("completed");
    expect(completed.finishedAt).not.toBeNull();
    expect(completed.output).toEqual({
      relevantFilesCount: 3,
      constraintsCount: 2,
    });
    expect(completed.error).toBeNull();
  });

  it("records stage attempt failure with error message", () => {
    const { stageAttemptRepo, run } = setup();

    const attempt = stageAttemptRepo.recordStart(run.id, "verify", 1);
    const failed = stageAttemptRepo.recordFailure(
      attempt.id,
      "Verification failed: 2 tests failed",
    );

    expect(failed.id).toBe(attempt.id);
    expect(failed.status).toBe("failed");
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.error).toBe("Verification failed: 2 tests failed");
  });

  it("lists all attempts for a run ordered chronologically", () => {
    const { stageAttemptRepo, run } = setup();

    const a1 = stageAttemptRepo.recordStart(run.id, "prepare", 1);
    stageAttemptRepo.recordCompletion(a1.id);

    const a2 = stageAttemptRepo.recordStart(run.id, "understand", 1);
    stageAttemptRepo.recordCompletion(a2.id);

    const a3 = stageAttemptRepo.recordStart(run.id, "implement", 1);
    stageAttemptRepo.recordCompletion(a3.id);

    const list = stageAttemptRepo.listForRun(run.id);
    expect(list.length).toBe(3);
    expect(list.map((a) => a.stage)).toEqual([
      "prepare",
      "understand",
      "implement",
    ]);
  });

  it("retrieves the latest attempt for a given stage", () => {
    const { stageAttemptRepo, run } = setup();

    stageAttemptRepo.recordStart(run.id, "verify", 1);
    stageAttemptRepo.recordFailure(
      (stageAttemptRepo.getLatestAttempt(run.id, "verify") as { id: string })
        .id,
      "fail 1",
    );

    const att2 = stageAttemptRepo.recordStart(run.id, "verify", 2);
    stageAttemptRepo.recordCompletion(att2.id, { passed: true });

    const latest = stageAttemptRepo.getLatestAttempt(run.id, "verify");
    expect(latest).not.toBeNull();
    expect(latest?.attempt).toBe(2);
    expect(latest?.status).toBe("completed");
  });
});
