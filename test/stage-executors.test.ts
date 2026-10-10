// test/stage-executors.test.ts — Unit tests for discrete Stage Executors (XFM-28, XFM-31, XFM-34).

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RunRecord } from "../src/db/run-repository.js";
import {
  DeliverExecutor,
  PrepareExecutor,
  ReviewExecutor,
  UnderstandExecutor,
} from "../src/executors/index.js";
import type { Project, PullRequest } from "../src/shared/types.js";
import type { BaselineState } from "../src/worktree-state.js";
import { createTestRepositories } from "./helpers/composition.js";
import {
  FAILING_REVIEW_OUTPUT,
  PASSING_REVIEW_OUTPUT,
  scriptedReviewSession,
  tempArtifactsDirs,
} from "./helpers/scripted-review-session.js";
import { executeStage, stageContext } from "./helpers/stage-harness.js";

const artifactDirs = tempArtifactsDirs();
afterAll(() => artifactDirs.cleanup());

describe("Stage Executors (XFM-28, XFM-31, XFM-34)", () => {
  const mockBaseline: BaselineState = {
    trackedFiles: new Set<string>(["src/index.ts"]),
    untrackedFiles: new Set<string>(),
  };

  function setupTestContext(stage: string, overrides?: Partial<RunRecord>) {
    const repos = createTestRepositories();
    const runRepo = repos.runs;

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

    const context = stageContext(repos, run, project, { stage });

    return { context, runRepo, repos, db: repos.db };
  }

  describe("PrepareExecutor (XFM-28)", () => {
    it("initializes branch, external worktree, and baseline", async () => {
      const { context, runRepo, repos } = setupTestContext("prepare");

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

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "prepare",
      );

      expect(branchCreated).toBe(true);
      expect(worktreeCreated).toBe(true);
      expect(result.outcome).toBe("passed");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.worktreePath).toBe("/isolated/worktree/path");
    });
  });

  describe("UnderstandExecutor (XFM-28)", () => {
    it("synthesizes implementation context and writes artifacts", async () => {
      const { context, runRepo, repos } = setupTestContext("understand", {
        status: "understanding",
      });
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

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "understand",
      );

      expect(result.outcome).toBe("passed");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.implementationContext?.relevantFiles).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    });
  });

  describe("ReviewExecutor (XFM-28)", () => {
    const mockVerification = {
      passed: true,
      repairAttempt: 0,
      tests: {
        command: "test",
        exitCode: 0,
        stdout: "",
        stderr: "",
        passed: true,
        durationMs: 0,
      },
      diff: "",
      filesChanged: [],
      hasPollution: false,
      summary: "Verification passed",
    };

    it("routes to deliver stage when review is approved", async () => {
      const { context, runRepo, repos } = setupTestContext("review", {
        status: "executing",
        artifactsDir: artifactDirs.make(),
      });
      runRepo.update(context.run.id, { verification: mockVerification });
      const updatedRunForTest = runRepo.get(context.run.id);
      if (updatedRunForTest) {
        context.run = updatedRunForTest;
      }

      const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);
      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () => session,
      });

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "review",
      );

      expect(result.outcome).toBe("passed");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.review?.passed).toBe(true);
      expect(updatedRun?.review?.summary).toBe(
        "Review passed: all 1 criteria satisfied with 0 blocking errors.",
      );

      // review.json is written once, by reviewRun, into the run's artifacts dir
      const artifact = JSON.parse(
        readFileSync(
          path.join(context.run.artifactsDir, "review.json"),
          "utf-8",
        ),
      );
      expect(artifact).toEqual(updatedRun?.review);
      expect(session.disposeCalls).toBe(1);
    });

    it("aborts an in-flight review when the stage signal aborts", async () => {
      const { context, runRepo } = setupTestContext("review", {
        artifactsDir: artifactDirs.make(),
      });
      runRepo.update(context.run.id, { verification: mockVerification });
      const persisted = runRepo.get(context.run.id);
      if (persisted) context.run = persisted;
      const controller = new AbortController();
      context.signal = controller.signal;

      const session = scriptedReviewSession("", {
        hangUntilAborted: true,
        onPrompt: () => queueMicrotask(() => controller.abort()),
      });
      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () => session,
      });

      await expect(executor.execute(context)).rejects.toThrow("Review aborted");
      expect(session.disposeCalls).toBe(1);
      expect(runRepo.get(context.run.id)?.review).toBeNull();
    });

    it("fails when review is rejected", async () => {
      const { context, runRepo } = setupTestContext("review", {
        artifactsDir: artifactDirs.make(),
      });
      runRepo.update(context.run.id, { verification: mockVerification });
      const updatedRunForTest = runRepo.get(context.run.id);
      if (updatedRunForTest) {
        context.run = updatedRunForTest;
      }

      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () =>
          scriptedReviewSession(FAILING_REVIEW_OUTPUT),
      });

      const result = await executor.execute(context);

      expect(result).toMatchObject({
        outcome: "rejected",
        reason: expect.stringContaining("Code review was not approved"),
      });
      expect(result.record?.run?.review?.findings).toEqual([
        { severity: "error", message: "Security concern found" },
      ]);
    });

    it("fails immediately without starting a review session if verification is missing", async () => {
      const { context } = setupTestContext("review", {
        artifactsDir: artifactDirs.make(),
      });
      let sessionsCreated = 0;

      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () => {
          sessionsCreated++;
          return scriptedReviewSession(PASSING_REVIEW_OUTPUT);
        },
      });

      const result = await executor.execute(context);

      expect(result.outcome).toBe("error");
      expect(result).toMatchObject({
        outcome: "error",
        error: expect.stringContaining("Deterministic verification is missing"),
      });
      expect(sessionsCreated).toBe(0);
    });

    it("gives the reviewer the persisted verification summary", async () => {
      const { context, runRepo } = setupTestContext("review", {
        artifactsDir: artifactDirs.make(),
      });

      const verification = {
        ...mockVerification,
        filesChanged: ["src/a.ts", "src/b.ts"],
      };
      runRepo.update(context.run.id, { verification });
      const persisted = runRepo.get(context.run.id);
      if (persisted) context.run = persisted;

      const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);

      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () => session,
      });

      await executor.execute(context);

      expect(session.prompts).toHaveLength(1);
      expect(session.prompts[0]).toContain(verification.summary);
      expect(session.prompts[0]).toContain("Changed files: src/a.ts, src/b.ts");
    });

    it("fails when no verification was persisted, because a stage runs on the run as stored", async () => {
      const { context, repos } = setupTestContext("review", {
        status: "executing",
        artifactsDir: artifactDirs.make(),
      });
      // The run in SQLite has no verification; the runner hands the executor that run.
      expect(repos.runs.get(context.run.id)?.verification).toBeNull();

      let sessionsCreated = 0;
      const executor = new ReviewExecutor({
        loadSettings: async () => ({}),
        sessionFactory: async () => {
          sessionsCreated++;
          return scriptedReviewSession(PASSING_REVIEW_OUTPUT);
        },
      });

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "review",
      );

      expect(result).toMatchObject({
        outcome: "error",
        error: expect.stringContaining("Deterministic verification is missing"),
      });
      expect(sessionsCreated).toBe(0);
    });
  });

  describe("DeliverExecutor (XFM-28)", () => {
    it("safely commits, pushes, and creates pull request", async () => {
      const { context, runRepo, repos } = setupTestContext("deliver", {
        status: "ready_for_pr",
      });

      let committed = false;
      let pushed = false;

      const executor = new DeliverExecutor({
        loadRecordedBaseline: async () => mockBaseline,
        safeCommitAll: async () => {
          committed = true;
        },
        push: async () => {
          pushed = true;
        },
        createPullRequest: async () => "https://github.com/org/repo/pull/42",
        getHeadSha: async () => "sha-head",
        getParentSha: async () => "sha-parent",
        getHeadMessage: async () => "msg",
        findExistingPullRequest: async () => null,
        getRemoteBranchSha: async () => null,
      });

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "deliver",
      );

      expect(committed).toBe(true);
      expect(pushed).toBe(true);
      expect(result.outcome).toBe("passed");
      expect((result.output as PullRequest).url).toBe(
        "https://github.com/org/repo/pull/42",
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
      expect(getStageExecutor("execute")).toBeDefined();
      expect(getStageExecutor("execute")).toBeDefined();
      expect(getStageExecutor("review")).toBeDefined();
      expect(getStageExecutor("deliver")).toBeDefined();

      expect(() => getStageExecutor("nonexistent_stage_xyz")).toThrow(
        "Unknown workflow stage",
      );

      const customExecutor = {
        stage: "custom_stage",
        execute: async () => ({ outcome: "passed" as const }),
      };
      registerStageExecutor("custom_stage", customExecutor);
      expect(getStageExecutor("custom_stage")).toBe(customExecutor);
    });
  });
});
