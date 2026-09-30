// test/canonical-verification-review-flow.test.ts — Tests for Issue #103: Canonical verification and review flow.

import { afterAll, describe, expect, it } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageContext } from "../src/executors/types.js";
import { HumanCheckpointSection } from "../src/frontend/components/runs/HumanCheckpointSection.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { patchRunCache } from "../src/frontend/lib/query-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { setDbForTesting } from "../src/runs.js";
import type {
  Project,
  ReviewResult,
  Run,
  VerificationResult,
} from "../src/shared/types.js";

function createMockSpawn() {
  return ((_cmd: string, _args?: readonly string[]) => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = () => true;
    setTimeout(() => {
      mockChild.emit("close", 0);
    }, 10);
    return mockChild as unknown as ChildProcess;
  }) as unknown as typeof spawn;
}

describe("Issue #103: Canonical Verification and Review Flow", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTestContext(overrides?: Partial<RunRecord>) {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const eventRepo = new EventRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const project: Project = {
      id: "test-proj",
      name: "Test Project",
      workspacePath: "/tmp/test-proj",
      repositoryPath: "/tmp/test-proj-repo",
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [],
      issueTracker: { provider: "jira" },
    };

    const run = runRepo.create({
      id: "run-flow-103",
      projectId: project.id,
      projectName: project.name,
      ticket: {
        id: "XF-103",
        title: "Canonical flow test",
        acceptanceCriteria: ["AC 1: Must verify", "AC 2: Must review"],
      },
      plan: "1. Code\n2. Verify\n3. Review",
      branch: "factory/xf-103",
      status: "executing",
      artifactsDir: "/tmp/artifacts-103",
      worktreePath: "/tmp/worktrees-103",
      ...overrides,
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "execute",
    });

    const attempt = stageAttemptRepo.recordStart(run.id, "execute", 1);

    const context: StageContext = {
      run,
      job,
      project,
      workerId: "test-worker-103",
      db,
      runRepo,
      jobRepo,
      eventRepo,
      stageAttemptRepo,
      operationLedgerRepo,
      attemptId: attempt.id,
    };

    return {
      context,
      runRepo,
      jobRepo,
      eventRepo,
      stageAttemptRepo,
      db,
    };
  }

  const sampleVerification: VerificationResult = {
    passed: true,
    repairAttempt: 1,
    tests: {
      command: "bun test",
      passed: true,
      exitCode: 0,
      stdout: "10 pass, 0 fail",
      stderr: "",
      durationMs: 50,
    },
    diff: "diff --git a/src/app.ts b/src/app.ts\n+ console.log('verified');",
    filesChanged: ["src/app.ts"],
    hasPollution: false,
    summary: "All 10 tests passed without pollution.",
  };

  const sampleReview: ReviewResult = {
    passed: true,
    findings: [
      { severity: "info", message: "Clean implementation", file: "src/app.ts" },
    ],
    criteriaChecked: [
      { criterion: "AC 1: Must verify", satisfied: true },
      { criterion: "AC 2: Must review", satisfied: true },
    ],
    summary: "All acceptance criteria verified and code quality approved.",
  };

  it("successful deterministic verification -> persisted result -> verification SSE event", async () => {
    const { context, runRepo, eventRepo } = setupTestContext();

    const executor = new ExecuteExecutor({
      loadSettings: async () => ({}),
      buildRepairPrompt: () => "REPAIR_PROMPT",
      writeFile: async () => {},
      spawn: createMockSpawn(),
      recordBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      runVerification: async () => sampleVerification,
      getDiff: async () => ({
        diff: sampleVerification.diff,
        filesChanged: sampleVerification.filesChanged,
      }),
      reviewExecutor: {
        stage: "review",
        execute: async (ctx) => {
          expect(ctx.run.verification).toEqual(sampleVerification);
          return { status: "success", nextRunStatus: "awaiting_review" };
        },
      },
    });

    const result = await executor.execute(context);
    expect(result.status).toBe("success");

    // Persisted to SQLite
    const persisted = runRepo.get(context.run.id);
    expect(persisted?.verification).toEqual(sampleVerification);
    expect(persisted?.diff).toBe(sampleVerification.diff);

    // Canonical verification event emitted
    const events = eventRepo.getEventsForRun(context.run.id);
    const verifEvent = events.find((e) => e.type === "verification");
    expect(verifEvent).toBeDefined();
    if (!verifEvent) throw new Error("Expected verifEvent");
    expect(
      (verifEvent.payload as { result: VerificationResult }).result,
    ).toEqual(sampleVerification);
  });

  it("verification failure -> repair flow -> final verification", async () => {
    const { context, runRepo, eventRepo } = setupTestContext();
    let attemptCount = 0;
    const writtenFiles: Record<string, string> = {};

    const failingVerification: VerificationResult = {
      passed: false,
      repairAttempt: 1,
      tests: {
        command: "bun test",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "AssertionError: expected true",
        durationMs: 40,
      },
      diff: "diff --git a/src/app.ts",
      filesChanged: ["src/app.ts"],
      hasPollution: false,
      summary: "Tests failed on attempt 1.",
    };

    const executor = new ExecuteExecutor({
      loadSettings: async () => ({}),
      buildRepairPrompt: (ticket, _plan, _v, attempt) =>
        `REPAIR ATTEMPT ${attempt} FOR ${ticket.id}`,
      writeFile: async (filepath: unknown, content: unknown) => {
        writtenFiles[path.basename(String(filepath))] = String(content);
      },
      spawn: createMockSpawn(),
      recordBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      runVerification: async (_w, _p, _b, attempt) => {
        attemptCount++;
        if (attempt === 1) {
          return failingVerification;
        }
        return {
          ...sampleVerification,
          repairAttempt: 2,
        };
      },
      getDiff: async () => ({
        diff: sampleVerification.diff,
        filesChanged: sampleVerification.filesChanged,
      }),
      reviewExecutor: {
        stage: "review",
        execute: async () => ({
          status: "success",
          nextRunStatus: "awaiting_review",
        }),
      },
      MAX_REPAIR_ATTEMPTS: 2,
    });

    const result = await executor.execute(context);
    expect(result.status).toBe("success");
    expect(attemptCount).toBe(2);

    // Repair prompt written for attempt 2
    expect(writtenFiles["PROMPT.md"]).toContain("REPAIR ATTEMPT 1 FOR XF-103");

    // Final passed verification persisted
    const persisted = runRepo.get(context.run.id);
    expect(persisted?.verification?.passed).toBe(true);
    expect(persisted?.verification?.repairAttempt).toBe(2);

    // Events emitted for both attempts
    const verifEvents = eventRepo
      .getEventsForRun(context.run.id)
      .filter((e) => e.type === "verification");
    expect(verifEvents.length).toBe(2);
    const firstVerif = verifEvents[0];
    const secondVerif = verifEvents[1];
    expect(firstVerif).toBeDefined();
    expect(secondVerif).toBeDefined();
    if (!firstVerif || !secondVerif) throw new Error("Expected 2 events");
    expect(
      (firstVerif.payload as { result: VerificationResult }).result.passed,
    ).toBe(false);
    expect(
      (secondVerif.payload as { result: VerificationResult }).result.passed,
    ).toBe(true);
  });

  it("successful review -> persisted review -> review SSE event", async () => {
    const { context, runRepo, eventRepo, db } = setupTestContext();
    // Persist verification first
    runRepo.update(context.run.id, { verification: sampleVerification }, db);

    const reviewExecutor = new ReviewExecutor({
      loadSettings: async () => ({}),
      reviewRun: async () => sampleReview,
      writeFile: async () => {},
    });

    const result = await reviewExecutor.execute(context);
    expect(result.status).toBe("success");
    expect(result.nextRunStatus).toBe("awaiting_review");

    // Persisted to SQLite
    const persisted = runRepo.get(context.run.id);
    expect(persisted?.review).toEqual(sampleReview);

    // Canonical review event emitted
    const events = eventRepo.getEventsForRun(context.run.id);
    const reviewEvent = events.find((e) => e.type === "review");
    expect(reviewEvent).toBeDefined();
    if (!reviewEvent) throw new Error("Expected reviewEvent");
    expect((reviewEvent.payload as { result: ReviewResult }).result).toEqual(
      sampleReview,
    );
  });

  it("review failure does not produce awaiting_review", async () => {
    const { context, runRepo, db } = setupTestContext();
    runRepo.update(context.run.id, { verification: sampleVerification }, db);

    const failingReview: ReviewResult = {
      passed: false,
      findings: [{ severity: "error", message: "Critical bug detected" }],
      criteriaChecked: [{ criterion: "AC 1: Must verify", satisfied: false }],
      summary: "Review failed due to critical bug.",
    };

    const reviewExecutor = new ReviewExecutor({
      loadSettings: async () => ({}),
      reviewRun: async () => failingReview,
      writeFile: async () => {},
    });

    const result = await reviewExecutor.execute(context);
    expect(result.status).toBe("failed");
    expect(result.nextRunStatus).toBe("failed");
    expect(result.nextRunStatus).not.toBe("awaiting_review");
    expect(result.error).toContain("Code review was not approved");

    // Persisted review record shows failed review
    const persisted = runRepo.get(context.run.id);
    expect(persisted?.review?.passed).toBe(false);
  });

  it("TanStack Query cache updates from SSE events", () => {
    const queryClient = new QueryClient();
    const runId = "run-cache-test";

    const initialRun: Run = {
      id: runId,
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/test",
      status: "executing",
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      implementationContext: null,
      verification: null,
      review: null,
      artifacts: [],
      diff: null,
      pullRequest: null,
      repairAttempts: 0,
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    };

    queryClient.setQueryData(queryKeys.run(runId), initialRun);
    queryClient.setQueryData(queryKeys.runs(), [initialRun]);

    // Apply verification SSE event
    patchRunCache(
      runId,
      {
        verification: sampleVerification,
        diff: sampleVerification.diff,
        repairAttempts: sampleVerification.repairAttempt,
      },
      queryClient,
    );

    const cachedAfterVerif = queryClient.getQueryData<Run>(
      queryKeys.run(runId),
    );
    expect(cachedAfterVerif?.verification).toEqual(sampleVerification);
    expect(cachedAfterVerif?.diff).toBe(sampleVerification.diff);

    // Apply review SSE event
    patchRunCache(runId, { review: sampleReview }, queryClient);

    const cachedAfterReview = queryClient.getQueryData<Run>(
      queryKeys.run(runId),
    );
    expect(cachedAfterReview?.review).toEqual(sampleReview);

    // Ensure list cache is also patched
    const cachedList = queryClient.getQueryData<Run[]>(queryKeys.runs());
    expect(cachedList?.[0]?.verification).toEqual(sampleVerification);
    expect(cachedList?.[0]?.review).toEqual(sampleReview);
  });

  it("HumanCheckpointSection renders real verification and review data", () => {
    const fullRun: Run = {
      id: "run-render-test",
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/test",
      status: "awaiting_review",
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      implementationContext: null,
      verification: sampleVerification,
      review: sampleReview,
      artifacts: [],
      diff: sampleVerification.diff,
      pullRequest: null,
      repairAttempts: 1,
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    };

    const queryClient = new QueryClient();
    const html = renderToString(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          ProjectProvider,
          null,
          React.createElement(
            ModalProvider,
            null,
            React.createElement(
              MemoryRouter,
              null,
              React.createElement(HumanCheckpointSection, {
                run: fullRun,
                onApprove: () => {},
                onReject: () => {},
              }),
            ),
          ),
        ),
      ),
    );

    // Real verification data rendered
    expect(html).toContain("PASSED");
    expect(html).toContain("All 10 tests passed without pollution.");
    expect(html).toContain("10 pass, 0 fail");
    expect(html).toContain("Files modified:");
    expect(html).toContain("src/app.ts");

    // Real review data rendered
    expect(html).toContain("All acceptance criteria verified");
    expect(html).toContain("AC 1: Must verify");
    expect(html).toContain("AC 2: Must review");
    expect(html).toContain("Clean implementation");

    // Awaiting review buttons rendered
    expect(html).toContain("btn-approve");
    expect(html).toContain("btn-reject");
  });

  it("HumanCheckpointSection renders meaningful empty states when results are genuinely unavailable", () => {
    const emptyRun: Run = {
      id: "run-empty-test",
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/test",
      status: "executing",
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      implementationContext: null,
      verification: null,
      review: null,
      artifacts: [],
      diff: null,
      pullRequest: null,
      repairAttempts: 0,
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    };

    const queryClient = new QueryClient();
    const html = renderToString(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          ProjectProvider,
          null,
          React.createElement(
            ModalProvider,
            null,
            React.createElement(
              MemoryRouter,
              null,
              React.createElement(HumanCheckpointSection, { run: emptyRun }),
            ),
          ),
        ),
      ),
    );

    // Empty state badges rendered without fabricating pass
    expect(html).toContain("AWAITING VERIFICATION");
    expect(html).toContain("No verification results available yet.");
    expect(html).toContain("AWAITING REVIEW");
    expect(html).toContain("No review results available yet.");
    expect(html).not.toContain("Deterministic checks passed");
  });

  it("complete canonical execution flow reaches awaiting_review", async () => {
    const { context, runRepo, db } = setupTestContext();

    const reviewExecutor = new ReviewExecutor({
      loadSettings: async () => ({}),
      reviewRun: async (input) => {
        // Must receive exact persisted verification
        const persisted = runRepo.get(input.runId, db);
        expect(persisted?.verification).toEqual(sampleVerification);
        expect(input.verification).toEqual(sampleVerification);
        return sampleReview;
      },
      writeFile: async () => {},
    });

    const executeExecutor = new ExecuteExecutor({
      loadSettings: async () => ({}),
      buildRepairPrompt: () => "REPAIR",
      writeFile: async () => {},
      spawn: createMockSpawn(),
      recordBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      runVerification: async () => sampleVerification,
      getDiff: async () => ({
        diff: sampleVerification.diff,
        filesChanged: sampleVerification.filesChanged,
      }),
      reviewExecutor,
    });

    const result = await executeExecutor.execute(context);

    expect(result.status).toBe("success");
    expect(result.nextRunStatus).toBe("awaiting_review");

    // Both verification and review persisted in SQLite
    const finalRun = runRepo.get(context.run.id, db);
    expect(finalRun?.verification).toEqual(sampleVerification);
    expect(finalRun?.review).toEqual(sampleReview);
  });

  it("complete end-to-end flow updates the UI without a hard refresh", () => {
    const queryClient = new QueryClient();
    const runId = "run-live-ui";

    const initialRun: Run = {
      id: runId,
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Live UI Test", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/live",
      status: "executing",
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      implementationContext: null,
      verification: null,
      review: null,
      artifacts: [],
      diff: null,
      pullRequest: null,
      repairAttempts: 0,
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    };

    queryClient.setQueryData(queryKeys.run(runId), initialRun);

    const onApproveMock = () => {};
    const onRejectMock = () => {};

    // Initial render: empty / awaiting states
    const render = () => {
      const currentRun = queryClient.getQueryData<Run>(queryKeys.run(runId));
      if (!currentRun) throw new Error("currentRun not found");
      return renderToString(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(
              ModalProvider,
              null,
              React.createElement(
                MemoryRouter,
                null,
                React.createElement(HumanCheckpointSection, {
                  run: currentRun,
                  onApprove: onApproveMock,
                  onReject: onRejectMock,
                }),
              ),
            ),
          ),
        ),
      );
    };

    const initialHtml = render();
    expect(initialHtml).toContain("AWAITING VERIFICATION");
    expect(initialHtml).toContain("AWAITING REVIEW");

    // Backend produces and emits verification event
    patchRunCache(
      runId,
      {
        verification: sampleVerification,
        diff: sampleVerification.diff,
      },
      queryClient,
    );

    const midHtml = render();
    expect(midHtml).toContain("PASSED");
    expect(midHtml).toContain("All 10 tests passed without pollution.");
    expect(midHtml).toContain("AWAITING REVIEW");

    // Backend produces and emits review event + status transition to awaiting_review
    patchRunCache(
      runId,
      {
        review: sampleReview,
        status: "awaiting_review",
      },
      queryClient,
    );

    const finalHtml = render();
    expect(finalHtml).toContain("PASSED");
    expect(finalHtml).toContain("All acceptance criteria verified");
    expect(finalHtml).toContain("btn-approve");
  });
});
