import { describe, expect, it } from "bun:test";
import type { CommandRecord } from "../src/db/command-repository.js";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import type { EventRepository } from "../src/db/event-repository.js";
import type { JobRecord, JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { RunRepository } from "../src/db/run-repository.js";
import type { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  type DeliverDependencies,
  DeliverExecutor,
} from "../src/executors/deliver.js";
import { Worker } from "../src/worker.js";

function claimFirstPendingCommand(
  commandRepo: CommandRepository,
): CommandRecord {
  const commands = commandRepo.claimPendingCommands("worker-1", 10000);
  const first = commands[0];
  if (!first) throw new Error("Expected a pending command to claim");
  return first;
}

describe("DeliverExecutor Reconciliation Recovery Branches (Issue #106)", () => {
  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);
    const commandRepo = new CommandRepository(db);

    const run = runRepo.create({
      id: "run-recov",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "D-1", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/D-1",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktrees",
    });

    return { db, runRepo, operationLedgerRepo, commandRepo, run };
  }

  function mockDeps(
    overrides: Partial<DeliverDependencies> = {},
  ): Partial<DeliverDependencies> {
    return {
      loadRecordedBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      safeCommitAll: async () => {},
      push: async () => {},
      createPullRequest: async () => "new-pr",
      findExistingPullRequest: async () => null,
      getHeadMessage: async () => "msg",
      getHeadSha: async () => "sha-head",
      getParentSha: async () => "sha-parent",
      getRemoteBranchSha: async () => "sha-remote",
      findCommitByMessageAndParent: async () => null,
      ...overrides,
    };
  }

  it("pending commit + matching external commit -> no duplicate commit", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent",
    });

    let commitCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            commitCalls++;
          },
          getHeadMessage: async () => "[X-Factory] D-1: Test",
          getHeadSha: async () => "sha-head",
          getParentSha: async () => "sha-parent",
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    await worker.processCommand(claimFirstPendingCommand(commandRepo));
    expect(commitCalls).toBe(0);
    expect(operationLedgerRepo.getOperation(run.id, "git_commit")?.status).toBe(
      "completed",
    );
  });

  it("pending commit + unrelated HEAD -> fails closed to avoid duplicate commit", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent",
    });

    let commitCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            commitCalls++;
          },
          getHeadMessage: async () => "Different commit msg",
          getHeadSha: async () => "sha-head-diff",
          getParentSha: async () => "sha-parent", // parent matches but message differs
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    // We expect it to fail closed
    expect(commitCalls).toBe(0);
    expect(operationLedgerRepo.getOperation(run.id, "git_commit")?.status).toBe(
      "pending",
    );
  });

  it("pending push + remote SHA equals local SHA -> no push", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordPending(run.id, "git_push");

    let pushCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          push: async () => {
            pushCalls++;
          },
          getHeadSha: async () => "sha-local",
          getRemoteBranchSha: async () => "sha-local", // Match
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    expect(pushCalls).toBe(0);
    expect(operationLedgerRepo.getOperation(run.id, "git_push")?.status).toBe(
      "completed",
    );
  });

  it("pending push + remote branch missing -> normal push", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordPending(run.id, "git_push");

    let pushCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          push: async () => {
            pushCalls++;
          },
          getHeadSha: async () => "sha-local",
          getRemoteBranchSha: async () => null, // Missing remote
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    expect(pushCalls).toBe(1);
    expect(operationLedgerRepo.getOperation(run.id, "git_push")?.status).toBe(
      "completed",
    );
  });

  it("pending push + conflicting remote SHA -> no force push and safe failure", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordPending(run.id, "git_push");

    let pushCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          push: async () => {
            pushCalls++;
            throw new Error("Git push rejected (non-fast-forward)");
          },
          getHeadSha: async () => "sha-local",
          getRemoteBranchSha: async () => "sha-remote-diff", // Conflicting
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    expect(pushCalls).toBe(1); // Proceeded to push safely
    expect(operationLedgerRepo.getOperation(run.id, "git_push")?.status).toBe(
      "failed",
    );
  });

  it("pending GitHub PR + matching PR -> no duplicate create", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordCompleted(run.id, "git_push", "p1", {
      pushed: true,
    });
    operationLedgerRepo.recordPending(run.id, "create_pr");

    let prCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          createPullRequest: async () => {
            prCalls++;
            return "new-url";
          },
          getHeadSha: async () => "sha-head",
          findExistingPullRequest: async () => ({
            url: "existing-url",
            headRefName: "factory/D-1",
            headRefOid: "sha-head", // Match
            baseRefName: "main",
            state: "OPEN",
          }),
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    await worker.processCommand(claimFirstPendingCommand(commandRepo));

    expect(prCalls).toBe(0);
    expect(operationLedgerRepo.getOperation(run.id, "create_pr")?.status).toBe(
      "completed",
    );
  });

  it("pending GitHub PR + no matching PR -> create once", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordCompleted(run.id, "git_push", "p1", {
      pushed: true,
    });
    operationLedgerRepo.recordPending(run.id, "create_pr");

    let prCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          createPullRequest: async () => {
            prCalls++;
            return "new-url";
          },
          getHeadSha: async () => "sha-head",
          findExistingPullRequest: async () => null, // Missing
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    await worker.processCommand(claimFirstPendingCommand(commandRepo));

    expect(prCalls).toBe(1);
    expect(operationLedgerRepo.getOperation(run.id, "create_pr")?.status).toBe(
      "completed",
    );
  });

  it("pending Azure PR + matching PR -> no duplicate create", async () => {
    const { db, operationLedgerRepo, runRepo, run } = setupTest();

    const project = {
      id: "proj-1",
      name: "Project 1",
      workspacePath: "/path",
      repositoryPath: "/path",
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [
        { id: "repo-1", path: "/path", name: "repo-1", defaultBranch: "main" },
      ],
      issueTracker: {
        provider: "azure" as const,
        azure: { orgUrl: "https://dev.azure.com/org", project: "proj" },
      },
    };

    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordCompleted(run.id, "git_push", "p1", {
      pushed: true,
    });
    operationLedgerRepo.recordPending(run.id, "create_pr");

    let prCalls = 0;
    const deliverExecutor = new DeliverExecutor(
      mockDeps({
        createPullRequest: async () => {
          prCalls++;
          return "new-az";
        },
        getHeadSha: async () => "sha-head",
        findExistingPullRequest: async () => ({
          url: "existing-az",
          sourceRefName: "refs/heads/factory/D-1", // Match
          targetRefName: "refs/heads/main",
          status: "active",
          lastMergeSourceCommit: "sha-head", // Match
        }),
      }),
    );

    await deliverExecutor.execute({
      run,
      project,
      job: {} as unknown as JobRecord,
      workerId: "worker-1",
      db,
      runRepo,
      jobRepo: {} as unknown as JobRepository,
      eventRepo: { appendEvent: () => {} } as unknown as EventRepository,
      stageAttemptRepo: {} as unknown as StageAttemptRepository,
      operationLedgerRepo,
      attemptId: "att-1",
    });

    expect(prCalls).toBe(0);
    expect(operationLedgerRepo.getOperation(run.id, "create_pr")?.status).toBe(
      "completed",
    );
  });

  it("pending Azure PR + no matching PR -> create once", async () => {
    const { db, operationLedgerRepo, runRepo, run } = setupTest();

    const project = {
      id: "proj-1",
      name: "Project 1",
      workspacePath: "/path",
      repositoryPath: "/path",
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [
        { id: "repo-1", path: "/path", name: "repo-1", defaultBranch: "main" },
      ],
      issueTracker: {
        provider: "azure" as const,
        azure: { orgUrl: "https://dev.azure.com/org", project: "proj" },
      },
    };

    operationLedgerRepo.recordCompleted(run.id, "git_commit", "c1", {
      committed: true,
    });
    operationLedgerRepo.recordCompleted(run.id, "git_push", "p1", {
      pushed: true,
    });
    operationLedgerRepo.recordPending(run.id, "create_pr");

    let prCalls = 0;
    const deliverExecutor = new DeliverExecutor(
      mockDeps({
        createPullRequest: async () => {
          prCalls++;
          return "new-az";
        },
        getHeadSha: async () => "sha-head",
        findExistingPullRequest: async () => null, // Missing
      }),
    );

    await deliverExecutor.execute({
      run,
      project,
      job: {} as unknown as JobRecord,
      workerId: "worker-1",
      db,
      runRepo,
      jobRepo: {} as unknown as JobRepository,
      eventRepo: { appendEvent: () => {} } as unknown as EventRepository,
      stageAttemptRepo: {} as unknown as StageAttemptRepository,
      operationLedgerRepo,
      attemptId: "att-1",
    });

    expect(prCalls).toBe(1);
    expect(operationLedgerRepo.getOperation(run.id, "create_pr")?.status).toBe(
      "completed",
    );
  });

  it("reconciliation throws -> no mutation", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent",
    });

    let commitCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            commitCalls++;
          },
          getHeadMessage: async () => {
            throw new Error("Git fail");
          }, // Throws during reconciliation
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    expect(commitCalls).toBe(0); // Failed closed
    expect(operationLedgerRepo.getOperation(run.id, "git_commit")?.status).toBe(
      "pending",
    );
  });
  it("pending commit + advanced HEAD recovery -> recovers without mutating", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    // A = preCommitSha
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent-A",
    });

    let commitCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            commitCalls++;
          },
          getHeadMessage: async () => "Later commit message C",
          getHeadSha: async () => "sha-C",
          getParentSha: async () => "sha-B",
          // B = intended X-Factory commit
          findCommitByMessageAndParent: async (_repoPath, msg, parentSha) => {
            if (
              msg === "[X-Factory] D-1: Test" &&
              parentSha === "sha-parent-A"
            ) {
              return "sha-B";
            }
            return null;
          },
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    await worker.processCommand(claimFirstPendingCommand(commandRepo));

    expect(commitCalls).toBe(0);
    const op = operationLedgerRepo.getOperation(run.id, "git_commit");
    expect(op?.status).toBe("completed");

    // Metadata preservation: if it recovers, it doesn't really matter what's in result right now,
    // but we can ensure it didn't mutate any state incorrectly.
  });

  it("pending commit + advanced HEAD without intended commit -> fails closed (no mutation)", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent-A",
    });

    let commitCalls = 0;
    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            commitCalls++;
          },
          // C = unrelated later commit
          getHeadMessage: async () => "Unrelated later commit C",
          getHeadSha: async () => "sha-C",
          getParentSha: async () => "sha-parent-A",
          findCommitByMessageAndParent: async () => null,
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    // Must not create a duplicate X-Factory commit (fail closed)
    expect(commitCalls).toBe(0);
    const op = operationLedgerRepo.getOperation(run.id, "git_commit");
    expect(op?.status).toBe("pending"); // remains pending
  });

  it("metadata preservation -> existing metadata is not overwritten on null reconcile", async () => {
    const { db, operationLedgerRepo, commandRepo, run } = setupTest();
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-original",
    });

    const worker = new Worker({
      workerId: "worker-1",
      db,
      deliverExecutor: new DeliverExecutor(
        mockDeps({
          safeCommitAll: async () => {
            throw new Error(
              "Simulate mutation failure to inspect preserved metadata",
            );
          },
          getHeadMessage: async () => "Different commit msg",
          getHeadSha: async () => "sha-original", // HEAD hasn't advanced, so reconcile returns null and mutation is allowed
          getParentSha: async () => "sha-parent",
          findCommitByMessageAndParent: async () => null,
        }),
      ),
    });

    commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `d:${run.id}`,
    });
    try {
      await worker.processCommand(claimFirstPendingCommand(commandRepo));
    } catch {}

    const op = operationLedgerRepo.getOperation(run.id, "git_commit");
    expect(op?.status).toBe("failed");
    // Verify it used sha-original (metadata wasn't replaced with a new prepareContext call)
    expect(
      (op?.result as { preCommitSha?: string } | null | undefined)
        ?.preCommitSha,
    ).toBe("sha-original");
  });
});
