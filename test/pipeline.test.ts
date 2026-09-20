// test/pipeline.test.ts — Characterization tests for Workflow Pipeline (runWorkflow, executeDeliverStage).

import { afterAll, beforeEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PiAgentSession } from "../src/agents/pi.js";
import { validateProject } from "../src/config.js";
import { RunEventBus } from "../src/events.js";
import {
  defaultPipelineDeps,
  executeDeliverStage,
  type PipelineDependencies,
  type PipelineStore,
  pipelineDeps,
  runWorkflow,
} from "../src/pipeline.js";
import { canTransition } from "../src/state-machine.js";
import type { InternalRun } from "../src/store.js";
import type {
  ImplementationContext,
  PullRequest,
  ReviewResult,
  RunEvent,
  RunStatus,
  Ticket,
  VerificationResult,
} from "../src/types.js";

// Controllable state for mocks
let mockVerificationResults: VerificationResult[] = [];
let mockReviewResult: ReviewResult = {
  passed: true,
  summary: "Review passed cleanly",
  findings: [],
  criteriaChecked: [{ criterion: "Test", satisfied: true }],
};
let mockSessionPromptFn: ((promptText: string) => Promise<void>) | null = null;
const mockContext: ImplementationContext = {
  relevantFiles: ["src/index.ts"],
  architecturalNotes: "Standard repo",
  existingBehavior: "Working",
  constraints: ["Pass tests"],
  risks: ["None"],
};
const mockPrUrl = "https://github.com/test-org/test-repo/pull/101";

const testPipelineDeps: PipelineDependencies = {
  branchExists: async () => false,
  createBranch: async () => {},
  createWorktree: async () => "/mock/worktree",
  recordBaseline: async () => ({
    trackedFiles: new Set<string>(),
    untrackedFiles: new Set<string>(),
  }),
  getDiff: async () => ({
    diff: "mock-diff",
    filesChanged: ["src/index.ts"],
  }),
  safeCommitAll: async () => {},
  push: async () => {},
  createPullRequest: async () => mockPrUrl,
  createAzurePullRequest: async () => ({ ok: true, url: mockPrUrl }),
  publishStatus: async () => ({ ok: true }),
  createImplementationSession: async () =>
    ({
      prompt: async (text: string) => {
        if (mockSessionPromptFn) {
          await mockSessionPromptFn(text);
        }
      },
      subscribe: () => () => {},
      steer: async () => {},
      abort: async () => {},
    }) as unknown as PiAgentSession,
  buildImplementationContext: async () => mockContext,
  buildImplementationPrompt: async () => "mock-implementation-prompt",
  runVerification: async (
    _worktree: string,
    _project: unknown,
    _baseline: unknown,
    attempt: number,
  ) => {
    if (mockVerificationResults.length > 0) {
      return (
        mockVerificationResults.shift() || {
          passed: true,
          hasPollution: false,
          repairAttempt: attempt,
          filesChanged: ["src/index.ts"],
          summary: "Verified",
          tests: {
            command: "bun test",
            passed: true,
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 5,
          },
          diff: "mock-diff",
        }
      );
    }
    return {
      passed: true,
      hasPollution: false,
      repairAttempt: attempt,
      filesChanged: ["src/index.ts"],
      summary: "Verified",
      tests: {
        command: "bun test",
        passed: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 5,
      },
      diff: "mock-diff",
    };
  },
  reviewRun: async () => mockReviewResult,
};

describe("Pipeline Orchestrator (src/pipeline.ts)", () => {
  const mockProject = validateProject({
    id: "pipe-proj",
    name: "Pipeline Project",
    repositoryPath: "/mock/repo",
    defaultBranch: "main",
    testCommand: "bun test",
  });

  const mockTicket: Ticket = {
    id: "PIPE-1",
    title: "Implement pipeline characterization",
    acceptanceCriteria: ["All stages execute deterministically"],
  };

  beforeEach(() => {
    Object.assign(pipelineDeps, testPipelineDeps);
  });

  async function setupRunFixture(): Promise<{
    run: InternalRun;
    store: PipelineStore;
    bus: RunEventBus;
    tempDir: string;
    statusEvents: RunStatus[];
    allEvents: RunEvent[];
  }> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-pipe-"));
    const store: PipelineStore = {
      transition: (r, s) => {
        if (!canTransition(r.status, s)) return false;
        r.status = s;
        return true;
      },
      persistRun: async () => {},
    };
    const bus = new RunEventBus();
    const statusEvents: RunStatus[] = [];
    const allEvents: RunEvent[] = [];

    const run: InternalRun = {
      id: "test-run-pipe",
      project: { id: mockProject.id, name: mockProject.name },
      ticket: mockTicket,
      plan: "Step 1: Test\nStep 2: Done",
      branch: "xfactory/pipe-1-branch",
      status: "preparing",
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
      artifactsDir: tempDir,
      worktreePath: "/mock/worktree",
      _session: null,
      _baseline: null,
      _project: mockProject,
    };

    bus.subscribe(run.id, (event: RunEvent) => {
      allEvents.push(event);
      if (event.type === "status") {
        statusEvents.push(event.status);
      }
    });

    // Reset mocks to clean happy path
    mockVerificationResults = [];
    mockReviewResult = {
      passed: true,
      summary: "Review passed cleanly",
      findings: [],
      criteriaChecked: [{ criterion: "Test", satisfied: true }],
    };
    mockSessionPromptFn = null;

    return { run, store, bus, tempDir, statusEvents, allEvents };
  }

  it("completes full happy path through all six stages to ready_for_pr", async () => {
    const { run, store, bus, tempDir, statusEvents } = await setupRunFixture();

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "ready_for_pr");
    // Verify observable status transition sequence
    assert.deepEqual(statusEvents, [
      "understanding",
      "implementing",
      "verifying",
      "reviewing",
      "ready_for_pr",
    ]);

    assert.ok(run.implementationContext);
    assert.ok(run.verification);
    assert.equal(run.verification.passed, true);
    assert.ok(run.review);
    assert.equal(run.review.passed, true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles verification failure and succeeds on repair attempt 2", async () => {
    const { run, store, bus, tempDir, statusEvents } = await setupRunFixture();

    const failingVerification: VerificationResult = {
      passed: false,
      hasPollution: false,
      repairAttempt: 1,
      filesChanged: ["src/index.ts"],
      summary: "Tests failed on attempt 1",
      tests: {
        command: "bun test",
        passed: false,
        exitCode: 1,
        stdout: "fail",
        stderr: "Error: boom",
        durationMs: 12,
      },
      diff: "diff",
    };

    const passingVerification: VerificationResult = {
      passed: true,
      hasPollution: false,
      repairAttempt: 2,
      filesChanged: ["src/index.ts"],
      summary: "Tests passed on attempt 2",
      tests: {
        command: "bun test",
        passed: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 8,
      },
      diff: "diff",
    };

    mockVerificationResults = [failingVerification, passingVerification];

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "ready_for_pr");
    assert.equal(run.repairAttempts, 1);
    // Sequences: verifying (att 1) -> implementing (repair) -> verifying (att 2) -> reviewing -> ready_for_pr
    assert.deepEqual(statusEvents, [
      "understanding",
      "implementing",
      "verifying",
      "implementing",
      "verifying",
      "reviewing",
      "ready_for_pr",
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("exhausts bounded repair limit of 3 attempts and transitions to failed", async () => {
    const { run, store, bus, tempDir, allEvents } = await setupRunFixture();

    const fail1: VerificationResult = {
      passed: false,
      hasPollution: false,
      repairAttempt: 1,
      filesChanged: [],
      summary: "Fail 1",
      tests: {
        command: "bun test",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "error",
        durationMs: 5,
      },
      diff: "",
    };
    const fail2: VerificationResult = {
      ...fail1,
      repairAttempt: 2,
      summary: "Fail 2",
    };
    const fail3: VerificationResult = {
      ...fail1,
      repairAttempt: 3,
      summary: "Fail 3",
    };

    mockVerificationResults = [fail1, fail2, fail3];

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "failed");
    assert.equal(run.repairAttempts, 3);
    assert.ok(
      allEvents.some(
        (e) => e.type === "error" && e.text.includes("Verification failed"),
      ),
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("transitions to failed when review rejects changes", async () => {
    const { run, store, bus, tempDir, statusEvents, allEvents } =
      await setupRunFixture();

    mockReviewResult = {
      passed: false,
      summary: "Blocking regressions introduced in authorization",
      findings: [{ severity: "error", message: "Regression" }],
      criteriaChecked: [{ criterion: "Test", satisfied: false }],
    };

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "failed");
    assert.ok(statusEvents.includes("reviewing"));
    assert.ok(!statusEvents.includes("ready_for_pr"));
    assert.ok(
      allEvents.some(
        (e) => e.type === "error" && e.text.includes("Review rejected"),
      ),
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("characterizes run stopped during understanding", async () => {
    const { run, store, bus, tempDir, statusEvents } = await setupRunFixture();

    // Simulate stopping during understanding stage
    bus.subscribe(run.id, (event: RunEvent) => {
      if (event.type === "status" && event.status === "understanding") {
        store.transition(run, "stopped");
      }
    });

    await runWorkflow(run, bus, store);

    // Run status correctly remains "stopped" because state machine prevents invalid transitions
    assert.equal(run.status, "stopped");
    assert.ok(statusEvents.includes("understanding"));

    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles run stopped during implementing without transitioning to failed", async () => {
    const { run, store, bus, tempDir, statusEvents } = await setupRunFixture();

    mockSessionPromptFn = async () => {
      // Simulate user stop while Pi agent session is active
      store.transition(run, "stopped");
      throw new Error("Aborted by user");
    };

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "stopped");
    assert.ok(!statusEvents.includes("failed"));
    assert.ok(!statusEvents.includes("verifying"));

    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles prompt failure during implementing by transitioning to failed", async () => {
    const { run, store, bus, tempDir, allEvents } = await setupRunFixture();

    mockSessionPromptFn = async () => {
      throw new Error("Model rate limit exceeded");
    };

    await runWorkflow(run, bus, store);

    assert.equal(run.status, "failed");
    assert.ok(
      allEvents.some(
        (e) => e.type === "error" && e.text.includes("Model rate limit"),
      ),
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("executes deliver stage: commits, pushes, creates PR, and transitions to pr_created", async () => {
    const { run, store, bus, tempDir, statusEvents } = await setupRunFixture();

    // Prepare run in ready_for_pr state
    run.worktreePath = "/mock/worktree";
    store.transition(run, "understanding");
    store.transition(run, "implementing");
    store.transition(run, "verifying");
    store.transition(run, "reviewing");
    store.transition(run, "ready_for_pr");

    const pr: PullRequest = await executeDeliverStage(run, bus, store);

    assert.equal(run.status, "pr_created");
    assert.equal(pr.url, mockPrUrl);
    assert.equal(pr.branch, run.branch);
    assert.ok(run.finishedAt);
    assert.ok(statusEvents.includes("pr_created"));

    await rm(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    Object.assign(pipelineDeps, defaultPipelineDeps);
  });
});
