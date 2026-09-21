// test/stage-executors.test.ts — Unit tests for discrete Stage Executors (XFM-28, XFM-31, XFM-34).

import { describe, expect, it } from "bun:test";
import type { PiAgentSession } from "../src/agents/pi.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  DeliverExecutor,
  ImplementExecutor,
  PrepareExecutor,
  ReviewExecutor,
  type StageContext,
  UnderstandExecutor,
  VerifyExecutor,
} from "../src/executors/index.js";
import type { BaselineState } from "../src/pollution.js";
import { finalizeDeliver } from "../src/services/deliver-service.js";
import type {
  Project,
  PullRequest,
  VerificationResult,
} from "../src/shared/types.js";

describe("Stage Executors (XFM-28, XFM-31, XFM-34)", () => {
  const mockBaseline: BaselineState = {
    trackedFiles: new Set<string>(["src/index.ts"]),
    untrackedFiles: new Set<string>(),
  };

  function setupTestContext(stage: string, overrides?: Partial<RunRecord>) {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
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
      id: "run-exec-1",
      projectId: project.id,
      projectName: project.name,
      ticket: {
        id: "T-100",
        title: "Executor Test",
        acceptanceCriteria: ["AC 1", "AC 2"],
      },
      plan: "Step 1: Test\nStep 2: Verify",
      branch: "factory/T-100",
      status: "preparing",
      artifactsDir: "/tmp/artifacts-exec-1",
      worktreePath: "/tmp/worktrees-exec-1",
      ...overrides,
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage,
    });

    const attempt = stageAttemptRepo.recordStart(run.id, stage, 1);

    const context: StageContext = {
      run,
      job,
      project,
      workerId: "test-worker-exec",
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
      stageAttemptRepo,
      operationLedgerRepo,
      db,
    };
  }

  describe("PrepareExecutor (XFM-28)", () => {
    it("initializes branch, external worktree, and baseline", async () => {
      const { context, runRepo } = setupTestContext("prepare");

      let branchCreated = false;
      let worktreeCreated = false;
      const writtenFiles: Record<string, string> = {};

      const executor = new PrepareExecutor({
        branchExists: async () => false,
        createBranch: async () => {
          branchCreated = true;
        },
        createWorktree: async () => {
          worktreeCreated = true;
          return "/isolated/worktree/path";
        },
        recordBaseline: async () => mockBaseline,
        writeFile: async (filePath, content) => {
          writtenFiles[filePath.toString()] = content.toString();
        },
      });

      const result = await executor.execute(context);

      expect(branchCreated).toBe(true);
      expect(worktreeCreated).toBe(true);
      expect(result.status).toBe("success");
      expect(result.nextStage).toBe("understand");
      expect(result.nextRunStatus).toBe("understanding");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.worktreePath).toBe("/isolated/worktree/path");
    });
  });

  describe("UnderstandExecutor (XFM-28)", () => {
    it("synthesizes implementation context and writes artifacts", async () => {
      const { context, runRepo } = setupTestContext("understand");
      const writtenFiles: Record<string, string> = {};

      const executor = new UnderstandExecutor({
        buildImplementationContext: async () => ({
          relevantFiles: ["src/a.ts", "src/b.ts"],
          conventions: ["biome", "typescript"],
          dependencies: ["bun"],
          constraints: ["no any"],
          architecturalNotes: "Architectural overview",
          existingBehavior: "Working existing tests",
          risks: ["None identified"],
        }),
        writeFile: async (filePath, content) => {
          writtenFiles[filePath.toString()] = content.toString();
        },
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextStage).toBe("implement");
      expect(result.nextRunStatus).toBe("implementing");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.implementationContext?.relevantFiles).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    });
  });

  describe("ImplementExecutor & Disposable Pi Sessions (XFM-28, XFM-34)", () => {
    it("creates disposable Pi session, runs prompt, aborts in finally, and records diff", async () => {
      const { context, runRepo } = setupTestContext("implement");

      let promptReceived = "";
      let sessionAborted = false;

      const mockSession: PiAgentSession = {
        prompt: async (text: string) => {
          promptReceived = text;
        },
        subscribe: () => () => {},
        steer: async () => {},
        abort: async () => {
          sessionAborted = true;
        },
      } as unknown as PiAgentSession;

      const executor = new ImplementExecutor({
        loadSettings: async () => ({}),
        buildImplementationPrompt: async () => "PROMPT: Implement feature",
        buildRepairPrompt: () => "PROMPT: Repair",
        createImplementationSession: async () => mockSession,
        getDiff: async () => ({
          diff: "diff --git a/test.ts",
          patch: "diff --git a/test.ts",
          filesChanged: ["test.ts"],
          linesAdded: 5,
          linesRemoved: 1,
        }),
      });

      const result = await executor.execute(context);

      expect(promptReceived).toBe("PROMPT: Implement feature");
      expect(sessionAborted).toBe(true);
      expect(result.status).toBe("success");
      expect(result.nextStage).toBe("verify");
      expect(result.nextRunStatus).toBe("verifying");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.diff).toBe("diff --git a/test.ts");
    });
  });

  describe("VerifyExecutor & Bounded Repair Loop (XFM-28, XFM-31)", () => {
    it("routes to review stage when verification passes", async () => {
      const { context, runRepo } = setupTestContext("verify");

      const executor = new VerifyExecutor({
        recordBaseline: async () => mockBaseline,
        runVerification: async () =>
          ({
            passed: true,
            summary: "All 10 tests passed",
            diff: "verified diff",
            checks: [],
          }) as unknown as VerificationResult,
        writeFile: async () => {},
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextStage).toBe("review");
      expect(result.nextRunStatus).toBe("reviewing");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.verification?.passed).toBe(true);
    });

    it("routes to retry/implement stage when verification fails within bounds", async () => {
      const { context, runRepo } = setupTestContext("verify", {
        repairAttempts: 0,
      });

      const executor = new VerifyExecutor({
        recordBaseline: async () => mockBaseline,
        runVerification: async () =>
          ({
            passed: false,
            summary: "2 tests failed",
            diff: "failing diff",
            checks: [],
          }) as unknown as VerificationResult,
        writeFile: async () => {},
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("retry");
      expect(result.nextStage).toBe("implement");
      expect(result.nextRunStatus).toBe("implementing");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.repairAttempts).toBe(1);
    });

    it("fails when verification repair attempts are exhausted", async () => {
      // MAX_REPAIR_ATTEMPTS is 3
      const { context } = setupTestContext("verify", {
        repairAttempts: 3,
      });

      const executor = new VerifyExecutor({
        recordBaseline: async () => mockBaseline,
        runVerification: async () =>
          ({
            passed: false,
            summary: "Tests still failing",
            diff: "diff",
            checks: [],
          }) as unknown as VerificationResult,
        writeFile: async () => {},
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.nextRunStatus).toBe("failed");
      expect(result.error).toContain("after 3 repair attempt(s)");
    });
  });

  describe("ReviewExecutor (XFM-28)", () => {
    it("routes to deliver stage when review is approved", async () => {
      const { context, runRepo } = setupTestContext("review");

      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        reviewRun: async () => ({
          passed: true,
          findings: [],
          criteriaChecked: [{ criterion: "Acceptance", satisfied: true }],
          summary: "LGTM!",
        }),
        writeFile: async () => {},
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextStage).toBeUndefined();
      expect(result.nextRunStatus).toBe("ready_for_pr");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.review?.passed).toBe(true);
    });

    it("fails when review is rejected", async () => {
      const { context } = setupTestContext("review");

      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        reviewRun: async () => ({
          passed: false,
          findings: [{ severity: "error", message: "Security concern found" }],
          criteriaChecked: [{ criterion: "Security", satisfied: false }],
          summary: "Security concern found",
        }),
        writeFile: async () => {},
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.nextRunStatus).toBe("failed");
      expect(result.error).toContain("Code review was not approved");
    });
  });

  describe("DeliverExecutor (XFM-28)", () => {
    it("safely commits, pushes, and creates pull request", async () => {
      const { context, runRepo } = setupTestContext("deliver", {
        status: "ready_for_pr",
      });

      let committed = false;
      let pushed = false;

      const executor = new DeliverExecutor({
        recordBaseline: async () => mockBaseline,
        safeCommitAll: async () => {
          committed = true;
        },
        push: async () => {
          pushed = true;
        },
        createAzurePullRequest: async () => ({ ok: true, url: "" }),
        createPullRequest: async () => "https://github.com/org/repo/pull/42",
      });

      const result = await executor.execute(context);

      expect(committed).toBe(true);
      expect(pushed).toBe(true);
      expect(result.status).toBe("success");
      expect((result.output as PullRequest).url).toBe(
        "https://github.com/org/repo/pull/42",
      );

      finalizeDeliver(
        context.db,
        context.runRepo,
        context.eventRepo,
        undefined,
        context.run.id,
        "cmd-test",
        context.workerId,
        result.output as PullRequest,
      );

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.pullRequest?.url).toBe(
        "https://github.com/org/repo/pull/42",
      );
      expect(updatedRun?.status).toBe("pr_created");
    });
  });

  describe("Executor Registry (src/executors/index.ts)", () => {
    it("resolves registered executors and throws for unknown stages", async () => {
      const { getStageExecutor, registerStageExecutor } = await import(
        "../src/executors/index.js"
      );
      expect(getStageExecutor("prepare")).toBeDefined();
      expect(getStageExecutor("understand")).toBeDefined();
      expect(getStageExecutor("implement")).toBeDefined();
      expect(getStageExecutor("verify")).toBeDefined();
      expect(getStageExecutor("review")).toBeDefined();
      expect(getStageExecutor("deliver")).toBeDefined();

      expect(() => getStageExecutor("nonexistent_stage_xyz")).toThrow(
        "Unknown workflow stage",
      );

      const customExecutor = {
        stage: "custom_stage",
        execute: async () => ({ status: "success" as const }),
      };
      registerStageExecutor("custom_stage", customExecutor);
      expect(getStageExecutor("custom_stage")).toBe(customExecutor);
    });
  });
});
