// test/run-event-union.test.ts — Discriminated union of run events matching what the server emits (#171).

import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting, steerRun } from "../src/runs.js";
import type {
  ChatAgentPayload,
  ChatUserPayload,
  ErrorEventPayload,
  InfoEventPayload,
  PiOutputChunkPayload,
  PrStepPayload,
  PullRequest,
  RalphProgressPayload,
  ReviewEventPayload,
  ReviewResult,
  Run,
  RunEvent,
  RunEventPayload,
  RunEventPayloadMap,
  RunEventType,
  StageEvidencePayload,
  StatusEventPayload,
  SteerEventPayload,
  UserFeedbackPayload,
  VerificationEventPayload,
  VerificationResult,
} from "../src/shared/types.js";

describe("Shared run-event union (#171)", () => {
  it("includes all emitted event types in the union including steer", () => {
    // Literal expectation of the canonical emitted run event types
    const expectedTypes: readonly RunEventType[] = [
      "status",
      "stage_evidence",
      "pr_step",
      "chat_user",
      "chat_agent",
      "user_feedback",
      "pi_output_chunk",
      "verification",
      "review",
      "ralph_progress",
      "steer",
      "info",
      "error",
    ];

    expect(expectedTypes).toHaveLength(13);

    // Static type assertion: every expected type is a valid RunEventType
    for (const t of expectedTypes) {
      expect(typeof t).toBe("string");
    }

    // Static check: "steer" must be assignable to RunEventType
    type IsSteerInUnion = "steer" extends RunEventType ? true : false;
    const steerInUnion: IsSteerInUnion = true;
    expect(steerInUnion).toBe(true);

    // Static check: RunEventPayloadMap maps each type to its payload
    type StatusPayloadFromMap = RunEventPayloadMap["status"];
    const testStatusPayload: StatusPayloadFromMap = { status: "queued" };
    expect(testStatusPayload.status).toBe("queued");

    // Static check: RunEventPayload discriminated union covers all members
    const samplePayload: RunEventPayload = {
      type: "status",
      payload: { status: "queued" },
    };
    expect(samplePayload.type).toBe("status");
  });

  it("models payload fields matching what producers write", () => {
    const pullRequest: PullRequest = {
      url: "https://github.com/example/repo/pull/1",
      branch: "factory/ticket-1",
      baseBranch: "main",
      title: "Fix issue 1",
    };

    // 1. status with pull request, text, reason
    const statusPayload: StatusEventPayload = {
      status: "pr_created",
      text: "Pull request created",
      message: "PR opened",
      reason: "Completed",
      pullRequest,
    };
    expect(statusPayload.status).toBe("pr_created");
    expect(statusPayload.pullRequest?.url).toBe(
      "https://github.com/example/repo/pull/1",
    );

    // 2. stage_evidence matching prepare, understand, plan, execute, review producers
    const prepareEvidence: StageEvidencePayload = {
      stage: "prepare",
      summary: "Branch prepared",
      branch: "factory/ticket-1",
      worktreePath: "/tmp/worktree",
    };
    const understandEvidence: StageEvidencePayload = {
      stage: "understand",
      summary: "Identified files",
      relevantFiles: ["src/index.ts"],
    };
    const planEvidence: StageEvidencePayload = {
      stage: "plan",
      summary: "Plan created",
      data: { plan: "Step 1" },
    };
    const executeEvidence: StageEvidencePayload = {
      stage: "execute",
      summary: "Execution passed",
      filesChanged: ["src/index.ts"],
      testsPassed: true,
    };
    const reviewEvidence: StageEvidencePayload = {
      stage: "review",
      evidence: "Review approved",
      passed: true,
      findingsCount: 0,
    };
    expect(prepareEvidence.stage).toBe("prepare");
    expect(understandEvidence.relevantFiles).toEqual(["src/index.ts"]);
    expect(planEvidence.data).toEqual({ plan: "Step 1" });
    expect(executeEvidence.testsPassed).toBe(true);
    expect(reviewEvidence.evidence).toBe("Review approved");

    // 3. pr_step matching deliver and deliver-service producers
    const branchPushedStep: PrStepPayload = {
      step: "branch_pushed",
      branch: "factory/ticket-1",
      commitSha: "abc1234",
    };
    const prOpenedStep: PrStepPayload = {
      step: "pr_opened",
      url: "https://github.com/example/repo/pull/1",
      branch: "factory/ticket-1",
    };
    const prCompletedStep: PrStepPayload = {
      step: "pr_completed",
      pullRequest,
    };
    expect(branchPushedStep.commitSha).toBe("abc1234");
    expect(prOpenedStep.url).toBe("https://github.com/example/repo/pull/1");
    expect(prCompletedStep.pullRequest?.title).toBe("Fix issue 1");

    // 4. chat_user and chat_agent
    const chatUser: ChatUserPayload = { text: "Hello agent" };
    const chatAgent: ChatAgentPayload = { text: "Hello user" };
    expect(chatUser.text).toBe("Hello agent");
    expect(chatAgent.text).toBe("Hello user");

    // 5. user_feedback matching requeue producer
    const feedback: UserFeedbackPayload = {
      failingTasks: ["Task 1"],
      notes: "Please fix task 1",
      text: "Feedback provided",
    };
    expect(feedback.failingTasks).toEqual(["Task 1"]);

    // 6. pi_output_chunk matching execute producer
    const piChunk: PiOutputChunkPayload = { chunk: "Compiling..." };
    expect(piChunk.chunk).toBe("Compiling...");

    // 7. verification and review results
    const verificationResult: VerificationResult = {
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
    const verificationPayload: VerificationEventPayload = {
      result: verificationResult,
    };
    expect(verificationPayload.result.passed).toBe(true);

    const reviewResult: ReviewResult = {
      passed: true,
      findings: [],
      criteriaChecked: [{ criterion: "Meets spec", satisfied: true }],
      summary: "LGTM",
    };
    const reviewPayload: ReviewEventPayload = {
      result: reviewResult,
    };
    expect(reviewPayload.result.passed).toBe(true);

    // 8. ralph_progress
    const ralphProgress: RalphProgressPayload = {
      text: "Iteration 1 finished",
      iteration: 1,
      task: "Task 1",
    };
    expect(ralphProgress.iteration).toBe(1);

    // 9. info and error
    const infoPayload: InfoEventPayload = { message: "Starting process" };
    const errorPayload: ErrorEventPayload = { message: "Failed process" };
    expect(infoPayload.message).toBe("Starting process");
    expect(errorPayload.message).toBe("Failed process");

    // 10. steer matching steerRun producer
    const steerPayload: SteerEventPayload = {
      message: "Steer focus to edge cases",
    };
    expect(steerPayload.message).toBe("Steer focus to edge cases");
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
      summary: "Prepared worktree",
      branch: "factory/t-1",
    });
    eventRepo.appendEvent(runId, "pr_step", {
      step: "branch_pushed",
      branch: "factory/t-1",
      commitSha: "feedbeef",
    });

    const req = new Request(`http://localhost/api/runs/${runId}/events`);
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
    if (event1 && event1.type === "stage_evidence") {
      expect(event1.payload.stage).toBe("prepare");
      expect(event1.id).toBe(2);
    }

    expect(event2?.type).toBe("pr_step");
    if (event2 && event2.type === "pr_step") {
      expect(event2.payload.step).toBe("branch_pushed");
      expect(event2.id).toBe(3);
    }

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
