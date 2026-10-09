// test/stage-idempotency.test.ts — Unit tests for Stage Idempotency & Reconstructable Baseline (XFM-32, XFM-33, XFM-35).

import { describe, expect, it } from "bun:test";
import { DeliverExecutor, PrepareExecutor } from "../src/executors/index.js";
import type { Project } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { stageContext } from "./helpers/stage-harness.js";

describe("Stage Idempotency & Reconstructable Verification (XFM-32, XFM-33, XFM-35)", () => {
  function setupTest(stage: string) {
    const repos = createTestRepositories();

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

    const run = repos.runs.create({
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

    const context = stageContext(repos, run, project, { stage });

    return { context, operationLedgerRepo: repos.operationLedger };
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
      expect(result1.outcome).toBe("passed");
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
      expect(result2.outcome).toBe("passed");
      expect(branchCreateCalls).toBe(1); // Unchanged!
      expect(worktreeCreateCalls).toBe(1); // Unchanged!
    });
  });

  describe("DeliverExecutor Idempotency (XFM-32, XFM-33)", () => {
    it("reuses created PR from operation ledger and does not invoke API twice", async () => {
      const { context, operationLedgerRepo } = setupTest("deliver");

      let apiCalls = 0;
      let commitCalls = 0;
      let pushCalls = 0;

      const executor = new DeliverExecutor({
        loadRecordedBaseline: async () => ({
          trackedFiles: new Set(["a.ts"]),
          untrackedFiles: new Set(),
        }),
        safeCommitAll: async () => {
          commitCalls++;
        },
        push: async () => {
          pushCalls++;
        },
        createPullRequest: async () => {
          apiCalls++;
          return "https://github.com/org/repo/pull/123";
        },
        getHeadSha: async () => "sha-head",
        getParentSha: async () => "sha-parent",
        getHeadMessage: async () => "msg",
        findExistingPullRequest: async () => null,
        getRemoteBranchSha: async () => null,
      });

      // First run: calls API and creates PR
      const result1 = await executor.execute(context);
      expect(result1.outcome).toBe("passed");
      expect(apiCalls).toBe(1);
      expect(commitCalls).toBe(1);
      expect(pushCalls).toBe(1);

      // Verify PR recorded in ledger
      const op = operationLedgerRepo.getOperation(context.run.id, "create_pr");
      expect(op?.status).toBe("completed");
      expect(op?.externalId).toBe("https://github.com/org/repo/pull/123");

      // Second run (e.g. deliver job retry or rerun): must reuse PR from ledger
      const result2 = await executor.execute(context);
      expect(result2.outcome).toBe("passed");
      expect(apiCalls).toBe(1); // API was NOT called again!
      expect(commitCalls).toBe(1); // Commit was NOT run again!
      expect(pushCalls).toBe(1); // Push was NOT run again!
      expect((result2.output as { url: string }).url).toBe(
        "https://github.com/org/repo/pull/123",
      );
    });
  });
});
