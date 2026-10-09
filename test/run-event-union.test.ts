// test/run-event-union.test.ts — Discriminated union of run events matching what the server emits (#171).

import { describe, expect, it, spyOn } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { runAttemptLoop } from "../src/attempt-loop.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { PlanExecutor } from "../src/executors/plan.js";
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageContext } from "../src/executors/types.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting, steerRun } from "../src/runs.js";
import { finalizeDeliver } from "../src/services/deliver-service.js";
import type {
  PullRequest,
  Run,
  RunEvent,
  VerificationResult,
} from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import {
  PASSING_REVIEW_OUTPUT,
  scriptedReviewSession,
} from "./helpers/scripted-review-session.js";

describe("Shared run-event union (#171)", () => {
  it("real producers write expected payload shapes: chat, steering, and transitions", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);
    const runId = "run-producer-lifecycle-test";

    runRepo.create({
      id: runId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: ["AC 1"] },
      plan: "Plan",
      branch: "factory/t-1",
      status: "awaiting_plan_approval",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    // 1. chatWithRun producer via handleApi (emits chat_user and chat_agent)
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const chatReq = new Request(
        `http://localhost:3777/api/runs/${runId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Can we verify edge cases?" }),
        },
      );
      const chatRes = await handleApi(chatReq, new URL(chatReq.url));
      expect(chatRes.status).toBe(200);
    } finally {
      errSpy.mockRestore();
    }

    const eventsAfterChat = eventRepo.getEventsForRun(runId);
    const chatUserEvt = eventsAfterChat.find((e) => e.type === "chat_user");
    expect(chatUserEvt).toBeDefined();
    expect(chatUserEvt?.payload).toEqual({ text: "Can we verify edge cases?" });

    const chatAgentEvt = eventsAfterChat.find((e) => e.type === "chat_agent");
    expect(chatAgentEvt).toBeDefined();
    expect(typeof chatAgentEvt?.payload.text).toBe("string");

    // 2. steerRun producer via handleApi (emits steer, requires executing status)
    runRepo.update(runId, { status: "executing" }, db);
    const steerReq = new Request(
      `http://localhost:3777/api/runs/${runId}/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Focus on unit tests first" }),
      },
    );
    const steerRes = await handleApi(steerReq, new URL(steerReq.url));
    expect(steerRes.status).toBe(200);

    const steerEvt = eventRepo
      .getEventsForRun(runId)
      .find((e) => e.type === "steer");
    expect(steerEvt).toBeDefined();
    expect(steerEvt?.payload).toEqual({ message: "Focus on unit tests first" });

    // 3. handleTransition requeue producer via handleApi (emits user_feedback and status)
    runRepo.update(runId, { status: "awaiting_review" }, db);
    const requeueReq = new Request(
      `http://localhost:3777/api/runs/${runId}/transitions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "requeue",
          payload: {
            failingTasks: ["Task 1"],
            chatNotes: "Please fix edge case handling",
          },
        }),
      },
    );
    const requeueRes = await handleApi(requeueReq, new URL(requeueReq.url));
    expect(requeueRes.status).toBe(200);

    const feedbackEvt = eventRepo
      .getEventsForRun(runId)
      .find((e) => e.type === "user_feedback");
    expect(feedbackEvt).toBeDefined();
    expect(feedbackEvt?.payload).toEqual({
      failingTasks: ["Task 1"],
      notes: "Please fix edge case handling",
      text: "Feedback provided: 1 failing tasks.",
    });

    const requeueStatusEvt = eventRepo
      .getEventsForRun(runId)
      .filter((e) => e.type === "status")
      .at(-1);
    expect(requeueStatusEvt?.payload).toEqual({
      status: "planning",
      text: "Requeueing run for fresh plan... Notes: Please fix edge case handling",
    });

    // 4. handleTransition restart producer (emits status)
    runRepo.update(runId, { status: "awaiting_plan_approval" }, db);
    const restartReq = new Request(
      `http://localhost:3777/api/runs/${runId}/transitions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      },
    );
    const restartRes = await handleApi(restartReq, new URL(restartReq.url));
    expect(restartRes.status).toBe(200);

    const restartStatusEvt = eventRepo
      .getEventsForRun(runId)
      .filter((e) => e.type === "status")
      .at(-1);
    expect(restartStatusEvt?.payload).toEqual({
      status: "understanding",
      text: "Restarting plan context...",
    });

    // 5. handleTransition abort / stop producer (emits status)
    runRepo.update(runId, { status: "awaiting_plan_approval" }, db);
    const stopReq = new Request(
      `http://localhost:3777/api/runs/${runId}/stop`,
      {
        method: "POST",
      },
    );
    const stopRes = await handleApi(stopReq, new URL(stopReq.url));
    expect(stopRes.status).toBe(200);

    const stopStatusEvt = eventRepo
      .getEventsForRun(runId)
      .filter((e) => e.type === "status")
      .at(-1);
    expect(stopStatusEvt?.payload).toEqual({
      status: "stopped",
      text: "Run stopped by user.",
    });

    // 6. Worker crash / recovery transition producer (emits status with reason)
    const worker = new Worker({
      workerId: "test-recovery-worker",
      db,
      pollIntervalMs: 100000,
    });
    const jobRepo = new JobRepository(db);

    runRepo.update(runId, { status: "executing" }, db);
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const job = jobRepo.createJob({
      runId,
      stage: "execute",
      status: "pending",
      maxAttempts: 3,
    });
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-worker-pid-8888',
          lease_until = $pastTime,
          attempts = 3
      WHERE id = $id;
    `).run({ $pastTime: pastTime, $id: job.id });

    // Also create an orphaned active run to exercise both recovery reason producers
    const orphanedRunId = "run-producer-orphaned";
    runRepo.create({
      id: orphanedRunId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-orphan", title: "Orphaned", acceptanceCriteria: [] },
      plan: "",
      branch: "factory/orphan",
      status: "understanding",
      artifactsDir: `/tmp/artifacts-${orphanedRunId}`,
      worktreePath: `/tmp/worktrees-${orphanedRunId}`,
    });

    await worker.recoverOnStartup();

    const recoveryStatusEvt = eventRepo
      .getEventsForRun(runId)
      .filter((e) => e.type === "status")
      .at(-1);
    expect(recoveryStatusEvt?.payload).toEqual({
      status: "recovery_required",
      reason: "Job attempts (3/3) exhausted for stage execute.",
    });

    const orphanRecoveryEvt = eventRepo
      .getEventsForRun(orphanedRunId)
      .filter((e) => e.type === "status")
      .at(-1);
    expect(orphanRecoveryEvt?.payload).toEqual({
      status: "recovery_required",
      reason:
        "Active run found without any pending or claimed workflow jobs on worker startup.",
    });

    // Directly assert exact payload stored in SQLite run_events
    const rawRunEvent = db
      .prepare(
        "SELECT payload FROM run_events WHERE run_id = $runId AND type = 'status' ORDER BY sequence DESC LIMIT 1",
      )
      .get({ $runId: runId }) as { payload: string };
    expect(JSON.parse(rawRunEvent.payload)).toEqual({
      status: "recovery_required",
      reason: "Job attempts (3/3) exhausted for stage execute.",
    });

    setDbForTesting(null);
  });

  it("real producers write expected payload shapes: plan, review, and deliver stages", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);
    const jobRepo = new JobRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const runId = "run-producer-stages-test";
    const run = runRepo.create({
      id: runId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-2", title: "Ticket 2", acceptanceCriteria: ["AC 2"] },
      plan: "",
      branch: "factory/t-2",
      status: "planning",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    const job = jobRepo.createJob({ runId, stage: "plan" });
    const attempt = stageAttemptRepo.recordStart(runId, "plan", 1);
    const context: StageContext = {
      run,
      job,
      project: {
        id: "proj-1",
        name: "Project 1",
        workspacePath: "/tmp",
        repositoryPath: "/tmp",
        defaultBranch: "main",
        testCommand: "true",
        repositories: [],
        issueTracker: { provider: "jira" },
      },
      workerId: "worker-stages-test",
      db,
      runRepo,
      jobRepo,
      eventRepo,
      stageAttemptRepo,
      operationLedgerRepo,
      attemptId: attempt.id,
    };

    // 1. PlanExecutor producer (emits info and stage_evidence)
    const planExecutor = new PlanExecutor();
    await planExecutor.execute(context);

    const eventsAfterPlan = eventRepo.getEventsForRun(runId);
    const infoEvt = eventsAfterPlan.find((e) => e.type === "info");
    expect(infoEvt).toBeDefined();
    expect(infoEvt?.payload).toEqual({ text: "Generating execution plan…" });

    const planEvidenceEvt = eventsAfterPlan.find(
      (e) => e.type === "stage_evidence",
    );
    expect(planEvidenceEvt).toBeDefined();
    expect(planEvidenceEvt?.payload).toEqual({
      stage: "plan",
      evidence: expect.stringContaining("Generated execution plan"),
    });

    // 2. ReviewExecutor producer (emits review and stage_evidence)
    const mockVerification: VerificationResult = {
      passed: true,
      repairAttempt: 0,
      tests: {
        command: "bun test",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        passed: true,
        durationMs: 120,
      },
      diff: "",
      filesChanged: [],
      hasPollution: false,
      summary: "All tests passed",
    };
    runRepo.update(runId, { verification: mockVerification }, db);

    const reviewExecutor = new ReviewExecutor({
      loadSettings: async () => ({}),
      sessionFactory: async () => scriptedReviewSession(PASSING_REVIEW_OUTPUT),
    });
    await reviewExecutor.execute(context);

    const eventsAfterReview = eventRepo.getEventsForRun(runId);
    const reviewEvt = eventsAfterReview.find((e) => e.type === "review");
    expect(reviewEvt).toBeDefined();
    expect(reviewEvt?.payload.result.passed).toBe(true);

    const reviewEvidenceEvt = eventsAfterReview
      .filter((e) => e.type === "stage_evidence")
      .find((e) => e.payload.stage === "review");
    expect(reviewEvidenceEvt).toBeDefined();
    expect(reviewEvidenceEvt?.payload).toEqual({
      stage: "review",
      evidence: expect.stringContaining("Review approved"),
    });

    // 3. finalizeDeliver producer (emits pr_step, stage_evidence, status)
    runRepo.update(runId, { status: "ready_for_pr" }, db);
    const pullRequest: PullRequest = {
      url: "https://github.com/example/repo/pull/42",
      branch: "factory/t-2",
      baseBranch: "main",
      title: "Deliver ticket 2",
    };
    finalizeDeliver(
      db,
      runRepo,
      eventRepo,
      undefined,
      runId,
      "",
      "worker-stages-test",
      pullRequest,
    );

    const eventsAfterDeliver = eventRepo.getEventsForRun(runId);
    const prStepEvt = eventsAfterDeliver.find((e) => e.type === "pr_step");
    expect(prStepEvt).toBeDefined();
    expect(prStepEvt?.payload).toEqual({
      step: "pr_created",
      url: pullRequest.url,
    });

    const deliverEvidenceEvt = eventsAfterDeliver
      .filter((e) => e.type === "stage_evidence")
      .find((e) => e.payload.stage === "deliver");
    expect(deliverEvidenceEvt).toBeDefined();
    expect(deliverEvidenceEvt?.payload).toEqual({
      stage: "deliver",
      evidence: `Pull Request created: ${pullRequest.url}`,
    });

    const prStatusEvt = eventsAfterDeliver
      .filter((e) => e.type === "status")
      .find((e) => e.payload.status === "pr_created");
    expect(prStatusEvt).toBeDefined();
    expect(prStatusEvt?.payload).toEqual({
      status: "pr_created",
      text: `Pull Request created: ${pullRequest.url}`,
      pullRequest,
    });
  });

  it("real producers write expected payload shapes: attempt loop and verification", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    const tempDir = await mkdtemp(path.join(tmpdir(), "run-al-producer-test-"));
    const worktreePath = path.join(tempDir, "worktree");
    const artifactsDir = path.join(tempDir, "artifacts");
    const binDir = path.join(tempDir, "bin");
    await mkdir(worktreePath, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });

    const sbxPath = path.join(binDir, "sbx");
    await writeFile(
      sbxPath,
      '#!/usr/bin/env bash\necho "Iteration 1 of 25"\nexit 1\n',
      { mode: 0o755 },
    );
    await chmod(sbxPath, 0o755);

    const runId = "run-attempt-loop-producer-test";
    const run = runRepo.create({
      id: runId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-3", title: "Ticket 3", acceptanceCriteria: [] },
      plan: "1. Step 1",
      branch: "factory/t-3",
      status: "executing",
      artifactsDir,
      worktreePath,
    });

    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath}`;

    const mockVerification: VerificationResult = {
      passed: true,
      repairAttempt: 0,
      tests: {
        command: "bun test",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        passed: true,
        durationMs: 40,
      },
      diff: "",
      filesChanged: [],
      hasPollution: false,
      summary: "Verification passed",
    };

    try {
      await runAttemptLoop({
        worktreePath,
        artifactsDir,
        ticket: run.ticket,
        plan: run.plan || "",
        project: {
          id: "proj-1",
          name: "Project 1",
          workspacePath: worktreePath,
          repositoryPath: worktreePath,
          defaultBranch: "main",
          testCommand: "true",
          repositories: [],
          issueTracker: { provider: "jira" },
        },
        baseline: { trackedFiles: new Set(), untrackedFiles: new Set() },
        provider: "anthropic",
        emit: (type, payload) => eventRepo.appendEvent(run.id, type, payload),
        onVerification: (verification) => {
          eventRepo.appendEvent(run.id, "verification", {
            result: verification,
          });
        },
      });

      // Verification result producer (as emitted by ExecuteExecutor.persistVerificationResult)
      eventRepo.appendEvent(run.id, "verification", {
        result: mockVerification,
      });
    } finally {
      process.env.PATH = oldPath;
      await rm(tempDir, { recursive: true, force: true });
    }

    const events = eventRepo.getEventsForRun(runId);

    const ralphProgressEvt = events.find((e) => e.type === "ralph_progress");
    expect(ralphProgressEvt).toBeDefined();
    expect(ralphProgressEvt?.payload).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Ralph Loop started"),
        iteration: 1,
      }),
    );

    const chunkEvt = events.find((e) => e.type === "pi_output_chunk");
    expect(chunkEvt).toBeDefined();
    expect(chunkEvt?.payload).toEqual(
      expect.objectContaining({
        role: "ralph",
        text: expect.any(String),
      }),
    );

    const errorEvt = events.find((e) => e.type === "error");
    expect(errorEvt).toBeDefined();
    expect(errorEvt?.payload).toEqual({
      message: "Ralph Loop failed with exit code 1",
    });

    const verificationEvt = events.find((e) => e.type === "verification");
    expect(verificationEvt).toBeDefined();
    expect(verificationEvt?.payload.result.passed).toBe(true);
  });

  it("uses one string timestamp type for RunEvent", () => {
    const event: RunEvent = {
      id: 1,
      timestamp: "2026-10-09T12:00:00.000Z",
      type: "chat_user",
      payload: { text: "Test message" },
    };

    expect(typeof event.timestamp).toBe("string");
    expect(event.timestamp).toBe("2026-10-09T12:00:00.000Z");

    // Static check: timestamp must be string, not number
    type TimestampType = RunEvent["timestamp"];
    type IsStringTimestamp = TimestampType extends string ? true : false;
    const isString: IsStringTimestamp = true;
    expect(isString).toBe(true);
  });

  it("does not have an events field on the Run wire type", () => {
    // Static check: "events" must not be a property of Run
    type HasEventsOnRun = "events" extends keyof Run ? true : false;
    const hasEvents: HasEventsOnRun = false;
    expect(hasEvents).toBe(false);
  });

  it("enforces typecheck on appendEvent: unknown types and invalid payloads are rejected", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    runRepo.create({
      id: "run-1",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/t-1",
      status: "executing",
      artifactsDir: "/tmp/artifacts-run-1",
      worktreePath: "/tmp/worktrees-run-1",
    });

    // Valid appends
    const statusEvt = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "Executing run",
    });
    expect(statusEvt.type).toBe("status");
    expect(statusEvt.payload).toEqual({
      status: "executing",
      text: "Executing run",
    });

    const chatEvt = eventRepo.appendEvent("run-1", "chat_user", {
      text: "User chat",
    });
    expect(chatEvt.type).toBe("chat_user");
    expect(chatEvt.payload).toEqual({ text: "User chat" });

    // The following lines MUST fail typecheck if uncommented.
    // They are tested via @ts-expect-error so `bun run typecheck` asserts failure.

    // @ts-expect-error Appending an unknown event type must fail typecheck
    eventRepo.appendEvent("run-1", "unknown_event_type", {});

    const steerEvt = eventRepo.appendEvent("run-1", "steer", {
      message: "steer msg",
    });
    expect(steerEvt.type).toBe("steer");
    expect(steerEvt.payload).toEqual({ message: "steer msg" });

    // @ts-expect-error Appending an invalid payload for steer must fail typecheck
    eventRepo.appendEvent("run-1", "steer", { message: 12345 });

    // @ts-expect-error Appending an invalid payload for chat_user must fail typecheck
    eventRepo.appendEvent("run-1", "chat_user", { wrongField: 123 });

    // @ts-expect-error Appending an invalid payload for chat_agent must fail typecheck
    eventRepo.appendEvent("run-1", "chat_agent", { text: 12345 });

    // @ts-expect-error Appending an invalid payload for status must fail typecheck
    eventRepo.appendEvent("run-1", "status", { status: "invalid_status" });

    const nullPrPayload = { status: "ready_for_pr", pullRequest: null };
    // @ts-expect-error Appending status with pullRequest as null must fail typecheck
    eventRepo.appendEvent("run-1", "status", nullPrPayload);

    // @ts-expect-error Appending pi_output_chunk without required role must fail typecheck
    eventRepo.appendEvent("run-1", "pi_output_chunk", { text: "chunk" });

    const badStagePayload = { stage: "invalid_stage" };
    // @ts-expect-error Appending an invalid payload for stage_evidence must fail typecheck
    eventRepo.appendEvent("run-1", "stage_evidence", badStagePayload);

    // @ts-expect-error Appending an invalid payload for verification must fail typecheck
    eventRepo.appendEvent("run-1", "verification", { result: "not-a-result" });
  });

  it("emits canonical events over the SSE public seam matching the union", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    const runId = "run-event-union-test";
    runRepo.create({
      id: runId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/t-1",
      status: "executing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    // Append representative events of different types
    eventRepo.appendEvent(runId, "chat_user", { text: "Hello from user" });
    eventRepo.appendEvent(runId, "stage_evidence", {
      stage: "prepare",
      evidence: "Prepared worktree",
    });
    eventRepo.appendEvent(runId, "pr_step", {
      step: "branch_pushed",
      text: "feedbeef",
    });

    const req = new Request(`http://localhost:3777/api/runs/${runId}/events`);
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Reader was not defined");
    }

    const dataLines: string[] = [];
    while (dataLines.length < 3) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const text = new TextDecoder().decode(value);
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          dataLines.push(line);
        }
      }
    }
    await reader.cancel();

    expect(dataLines.length).toBeGreaterThanOrEqual(3);

    const parsedEvents: RunEvent[] = dataLines.map((l) =>
      JSON.parse(l.slice(6)),
    );

    const event0 = parsedEvents[0];
    const event1 = parsedEvents[1];
    const event2 = parsedEvents[2];

    // Literal checks on emitted wire shapes
    expect(event0?.type).toBe("chat_user");
    expect(event0?.payload).toEqual({ text: "Hello from user" });
    expect(typeof event0?.timestamp).toBe("string");
    expect(event0?.id).toBe(1);

    expect(event1?.type).toBe("stage_evidence");
    if (event1?.type !== "stage_evidence") {
      throw new Error(`Expected stage_evidence, got ${event1?.type}`);
    }
    expect(event1.payload.stage).toBe("prepare");
    expect(event1.payload.evidence).toBe("Prepared worktree");
    expect(event1.id).toBe(2);

    expect(event2?.type).toBe("pr_step");
    if (event2?.type !== "pr_step") {
      throw new Error(`Expected pr_step, got ${event2?.type}`);
    }
    expect(event2.payload.step).toBe("branch_pushed");
    expect(event2.payload.text).toBe("feedbeef");
    expect(event2.id).toBe(3);

    setDbForTesting(null);
  });

  it("steering a run appends a steer event with the message and renders in ChatThread", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    const runId = "run-steer-render-test";
    runRepo.create({
      id: runId,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/t-1",
      status: "executing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    const steerMsg = "Focus on resolving the unit tests first";
    await steerRun(runId, steerMsg);

    const events = eventRepo.getEventsForRun(runId);
    const steerEvent = events.find((e) => e.type === "steer");
    expect(steerEvent).toBeDefined();
    expect(steerEvent?.payload).toEqual({ message: steerMsg });

    // Verify ChatThread renders the steer bubble with badge and message
    const wireEvents: RunEvent[] = events.map((e) => ({
      id: e.sequence,
      timestamp: e.createdAt,
      type: e.type,
      payload: e.payload,
    })) as RunEvent[];

    const html = renderToString(
      React.createElement(ChatThread, { events: wireEvents }),
    );
    expect(html).toContain("bubble-steer");
    expect(html).toContain("Steer Action");
    expect(html).toContain(steerMsg);

    setDbForTesting(null);
  });
});
