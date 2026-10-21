// test/stage-executors.test.ts — Unit tests for discrete Stage Executors (XFM-28, XFM-31, XFM-34).

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunRecord } from "../src/db/run-repository.js";
import {
  DeliverExecutor,
  PrepareExecutor,
  ReviewExecutor,
  UnderstandExecutor,
} from "../src/executors/index.js";
import { PlanExecutor } from "../src/executors/plan.js";
import type { Project, PullRequest } from "../src/shared/types.js";
import type { BaselineState } from "../src/worktree-state.js";
import { createTestRepositories } from "./helpers/composition.js";
import {
  stubResolveRole,
  testResolvedModel,
} from "./helpers/resolved-model.js";
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
    it("persists the Builder's understanding and writes the artifact (#282)", async () => {
      const dir = artifactDirs.make();
      mkdirSync(path.join(dir, "src"), { recursive: true });
      writeFileSync(path.join(dir, "src", "a.ts"), "export {};\n");
      writeFileSync(path.join(dir, "src", "b.ts"), "export {};\n");

      const { context, runRepo, repos } = setupTestContext("understand", {
        status: "understanding",
        worktreePath: dir,
        artifactsDir: dir,
      });

      const executor = new UnderstandExecutor({
        resolveRole: stubResolveRole,
        sessionFactory: async () =>
          scriptedReviewSession(
            "RELEVANT_FILES:\n- src/a.ts\n- src/b.ts\n\nSUMMARY:\nTouches two modules.\n\nEXISTING_BEHAVIOR:\nBoth export nothing.\n\nARCHITECTURAL_NOTES:\nOne module per file.\n\nCONSTRAINTS:\n- Keep it small.\n\nRISKS:\n- Imports break.\n",
          ),
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
      // the artifact holds exactly what the run holds
      expect(
        JSON.parse(
          readFileSync(path.join(dir, "implementation-context.json"), "utf-8"),
        ),
      ).toEqual(updatedRun?.implementationContext);
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
      // The scripted reviewer assesses exactly the run's one criterion; under
      // the fail-closed rules any other criteria would be "not assessed".
      const { context, runRepo, repos } = setupTestContext("review", {
        status: "executing",
        artifactsDir: artifactDirs.make(),
        ticket: {
          id: "T-100",
          title: "Executor Test",
          acceptanceCriteria: ["Acceptance"],
        },
      });
      runRepo.update(context.run.id, { verification: mockVerification });
      const updatedRunForTest = runRepo.get(context.run.id);
      if (updatedRunForTest) {
        context.run = updatedRunForTest;
      }

      const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);
      const executor = new ReviewExecutor({
        resolveRole: stubResolveRole,
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

    it("forwards the reviewer's tool activity as run events instead of dropping it (#256)", async () => {
      const { context, runRepo, repos } = setupTestContext("review", {
        status: "executing",
        artifactsDir: artifactDirs.make(),
        ticket: {
          id: "T-100",
          title: "Executor Test",
          acceptanceCriteria: ["Acceptance"],
        },
      });
      runRepo.update(context.run.id, { verification: mockVerification });
      const persisted = runRepo.get(context.run.id);
      if (persisted) context.run = persisted;

      const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT, {
        tools: ["read", "grep"],
      });
      const executor = new ReviewExecutor({
        resolveRole: async () => testResolvedModel("reviewer"),
        sessionFactory: async () => session,
      });

      const result = await executeStage(
        repos,
        executor,
        context.run.id,
        "review",
      );
      expect(result.outcome).toBe("passed");

      const activity = repos.events
        .getEventsForRun(context.run.id)
        .filter((e) => e.type === "review_activity")
        .map((e) => e.payload as { tool?: string; text?: string });
      // The reviewer's answer is streamed as activity text, and each tool call is named.
      expect(activity.some((a) => a.text && !a.tool)).toBe(true);
      expect(activity.flatMap((a) => (a.tool ? [a.tool] : []))).toEqual([
        "read",
        "grep",
      ]);
      for (const line of activity) {
        if (line.tool) expect(line.text).toContain(line.tool);
      }
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
        resolveRole: stubResolveRole,
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
        resolveRole: stubResolveRole,
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
        resolveRole: stubResolveRole,
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
        resolveRole: stubResolveRole,
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
        resolveRole: stubResolveRole,
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

  describe("PlanExecutor (#256)", () => {
    // The plan is the Builder's own answer (#282); plan_ready carries exactly
    // the plan the run stores, so the timeline needn't re-read the run.
    it("streams the plan text as a plan_ready event", async () => {
      const { context, repos } = setupTestContext("plan", {
        plan: "",
        status: "planning",
      });
      const answer =
        "# Execution Plan for #T-100\n\n1. Add `test/a.test.ts`.\n2. Change `src/a.ts`.\n";
      const outcome = await executeStage(
        repos,
        new PlanExecutor({
          resolveRole: async () => testResolvedModel("builder"),
          sessionFactory: async () => scriptedReviewSession(answer),
        }),
        context.run.id,
        "plan",
      );

      expect(outcome.outcome).toBe("passed");
      const planReady = repos.events
        .getEventsForRun(context.run.id)
        .find((e) => e.type === "plan_ready");
      const storedPlan = repos.runs.get(context.run.id)?.plan;
      expect(storedPlan).toContain("Execution Plan for #T-100");
      expect(planReady?.payload).toEqual({ plan: storedPlan ?? "" });
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
