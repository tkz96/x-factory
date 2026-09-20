// test/stage-idempotency.test.ts — Unit tests for Stage Idempotency & Reconstructable Baseline (XFM-32, XFM-33, XFM-35).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  DeliverExecutor,
  PrepareExecutor,
  type StageContext,
  VerifyExecutor,
} from "../src/executors/index.js";
import type { BaselineState } from "../src/pollution.js";
import type { Project, VerificationResult } from "../src/shared/types.js";

describe("Stage Idempotency & Reconstructable Verification (XFM-32, XFM-33, XFM-35)", () => {
  function setupTest(stage: string) {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const eventRepo = new EventRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const project: Project = {
      id: "idempotency-proj",
      name: "Idempotency Project",
      workspacePath: "/tmp/idem-proj",
      repositoryPath: "/tmp/idem-repo",
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [],
      issueTracker: { provider: "jira" },
    };

    const run = runRepo.create({
      id: "run-idem-1",
      projectId: project.id,
      projectName: project.name,
      ticket: {
        id: "XF-IDEM",
        title: "Idempotency Testing",
        acceptanceCriteria: ["AC 1"],
      },
      plan: "Test Plan",
      branch: "factory/XF-IDEM",
      status: "preparing",
      artifactsDir: "/tmp/artifacts/run-idem-1",
      worktreePath: "/tmp/worktrees/run-idem-1",
    });

    const job = jobRepo.createJob({ runId: run.id, stage });
    const attempt = stageAttemptRepo.recordStart(run.id, stage, 1);

    const context: StageContext = {
      run,
      job,
      project,
      workerId: "test-worker-idem",
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

  describe("PrepareExecutor Idempotency (XFM-32, XFM-35)", () => {
    it("safely reuses existing branch, worktree, and baseline on retry", async () => {
      const { context, operationLedgerRepo } = setupTest("prepare");

      let branchCreateCalls = 0;
      let worktreeCreateCalls = 0;
      const writtenFiles: Record<string, string> = {};

      const deps = {
        branchExists: async () => branchCreateCalls > 0,
        createBranch: async () => {
          branchCreateCalls++;
        },
        createWorktree: async () => {
          worktreeCreateCalls++;
          return "/tmp/worktrees/run-idem-1";
        },
        worktreeExists: async () => worktreeCreateCalls > 0,
        recordBaseline: async () => ({
          trackedFiles: new Set(["file1.ts", "file2.ts"]),
          untrackedFiles: new Set(["temp.txt"]),
        }),
        writeFile: async (filepath: string, content: string) => {
          writtenFiles[filepath] = content;
        },
        readFile: async (filepath: string) => {
          if (writtenFiles[filepath]) return writtenFiles[filepath];
          throw new Error("File not found");
        },
      };

      const executor = new PrepareExecutor(deps);

      // 1. First execution: creates branch, creates worktree, writes baseline.json
      const result1 = await executor.execute(context);
      expect(result1.status).toBe("success");
      expect(branchCreateCalls).toBe(1);
      expect(worktreeCreateCalls).toBe(1);
      expect(
        writtenFiles["/tmp/artifacts/run-idem-1/baseline.json"],
      ).toBeDefined();

      // Check operation ledger has completed operations
      expect(
        operationLedgerRepo.getOperation(context.run.id, "create_branch")
          ?.status,
      ).toBe("completed");
      expect(
        operationLedgerRepo.getOperation(context.run.id, "create_worktree")
          ?.status,
      ).toBe("completed");

      // 2. Second execution (retry/re-run): must NOT recreate branch or worktree
      const result2 = await executor.execute(context);
      expect(result2.status).toBe("success");
      expect(branchCreateCalls).toBe(1); // Unchanged!
      expect(worktreeCreateCalls).toBe(1); // Unchanged!
    });
  });

  describe("VerifyExecutor Reconstructable Baseline (XFM-35)", () => {
    it("reconstructs exact baseline state from baseline.json artifact", async () => {
      const { context } = setupTest("verify");

      const savedBaseline = {
        trackedFiles: ["index.ts", "utils.ts"],
        untrackedFiles: ["notes.txt"],
      };

      let baselinePassedToVerify: BaselineState | null = null;

      const mockVResult: VerificationResult = {
        passed: true,
        repairAttempt: 1,
        tests: {
          command: "test",
          exitCode: 0,
          stdout: "pass",
          stderr: "",
          passed: true,
          durationMs: 10,
        },
        diff: "diff --git a/index.ts b/index.ts",
        filesChanged: ["index.ts"],
        hasPollution: false,
        summary: "1/1 tests passed",
      };

      const executor = new VerifyExecutor({
        readFile: async (filepath: string) => {
          if (filepath.endsWith("baseline.json")) {
            return JSON.stringify(savedBaseline);
          }
          throw new Error("File not found");
        },
        writeFile: async () => {},
        recordBaseline: async () => {
          throw new Error(
            "Should not record fresh baseline when baseline.json exists!",
          );
        },
        runVerification: async (_wt, _proj, baseline) => {
          baselinePassedToVerify = baseline;
          return mockVResult;
        },
      });

      const result = await executor.execute(context);
      expect(result.status).toBe("success");
      const captured = baselinePassedToVerify as BaselineState | null;
      expect(captured).not.toBeNull();
      if (!captured) throw new Error("Expected baseline to be captured");
      expect(captured.trackedFiles.has("index.ts")).toBe(true);
      expect(captured.trackedFiles.has("utils.ts")).toBe(true);
      expect(captured.untrackedFiles.has("notes.txt")).toBe(true);
    });
  });

  describe("DeliverExecutor Idempotency (XFM-32, XFM-33)", () => {
    it("reuses created PR from operation ledger and does not invoke API twice", async () => {
      const { context, operationLedgerRepo } = setupTest("deliver");

      let apiCalls = 0;
      let commitCalls = 0;
      let pushCalls = 0;

      const executor = new DeliverExecutor({
        recordBaseline: async () => ({
          trackedFiles: new Set(["a.ts"]),
          untrackedFiles: new Set(),
        }),
        safeCommitAll: async () => {
          commitCalls++;
        },
        push: async () => {
          pushCalls++;
        },
        createAzurePullRequest: async () => ({ ok: true, url: "" }),
        createPullRequest: async () => {
          apiCalls++;
          return "https://github.com/org/repo/pull/123";
        },
      });

      // First run: calls API and creates PR
      const result1 = await executor.execute(context);
      expect(result1.status).toBe("success");
      expect(apiCalls).toBe(1);
      expect(commitCalls).toBe(1);
      expect(pushCalls).toBe(1);

      // Verify PR recorded in ledger
      const op = operationLedgerRepo.getOperation(context.run.id, "create_pr");
      expect(op?.status).toBe("completed");
      expect(op?.externalId).toBe("https://github.com/org/repo/pull/123");

      // Second run (e.g. deliver job retry or rerun): must reuse PR from ledger
      const result2 = await executor.execute(context);
      expect(result2.status).toBe("success");
      expect(apiCalls).toBe(1); // API was NOT called again!
      expect(commitCalls).toBe(1); // Commit was NOT run again!
      expect(pushCalls).toBe(1); // Push was NOT run again!
      expect((result2.output as { url: string }).url).toBe(
        "https://github.com/org/repo/pull/123",
      );
    });
  });
});
