// test/operation-ledger.test.ts — Unit tests for durable Operation Ledger (XFM-33).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { RunRepository } from "../src/db/run-repository.js";

describe("Operation Ledger Repository (XFM-33)", () => {
  function setupDb() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const ledgerRepo = new OperationLedgerRepository(db);

    const run = runRepo.create({
      id: "run-ledger-test-1",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
      plan: "Test Plan",
      branch: "factory/T-1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts/run-ledger-test-1",
      worktreePath: "/tmp/worktrees/run-ledger-test-1",
    });

    return { db, runRepo, ledgerRepo, run };
  }

  it("records pending, completed, and failed mutations", () => {
    const { ledgerRepo, run } = setupDb();

    // 1. Record pending
    const pending = ledgerRepo.recordPending(run.id, "create_branch");
    expect(pending.status).toBe("pending");
    expect(pending.operation).toBe("create_branch");
    expect(pending.runId).toBe(run.id);

    // 2. Complete mutation
    const completed = ledgerRepo.recordCompleted(
      run.id,
      "create_branch",
      "branch-sha-123",
      { created: true, name: "factory/T-1" },
    );
    expect(completed.status).toBe("completed");
    expect(completed.externalId).toBe("branch-sha-123");
    expect(completed.result).toEqual({ created: true, name: "factory/T-1" });

    // 3. Query operation
    const queried = ledgerRepo.getOperation(run.id, "create_branch");
    expect(queried?.status).toBe("completed");
    expect(queried?.externalId).toBe("branch-sha-123");

    // 4. Record failure for another operation
    const failed = ledgerRepo.recordFailed(
      run.id,
      "git_push",
      "Network connection timed out",
    );
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Network connection timed out");

    // 5. List all operations for run
    const ops = ledgerRepo.listForRun(run.id);
    expect(ops.length).toBe(2);
    expect(ops.map((o) => o.operation)).toEqual(["create_branch", "git_push"]);
  });

  it("executeWithLedger executes external mutation and caches result", async () => {
    const { ledgerRepo, run } = setupDb();

    let externalCalls = 0;
    const executeMutation = async () => {
      externalCalls++;
      return {
        externalId: "https://github.com/org/repo/pull/99",
        result: { prNumber: 99, url: "https://github.com/org/repo/pull/99" },
      };
    };

    // First execution: should call the function
    const result1 = await ledgerRepo.executeWithLedger(
      run.id,
      "create_pr",
      executeMutation,
    );
    expect(externalCalls).toBe(1);
    expect(result1).toEqual({
      prNumber: 99,
      url: "https://github.com/org/repo/pull/99",
    });

    // Verify record in database
    const op = ledgerRepo.getOperation(run.id, "create_pr");
    expect(op?.status).toBe("completed");
    expect(op?.externalId).toBe("https://github.com/org/repo/pull/99");

    // Second execution (retry/idempotent rerun): MUST NOT call external function again!
    const result2 = await ledgerRepo.executeWithLedger(
      run.id,
      "create_pr",
      executeMutation,
    );
    expect(externalCalls).toBe(1); // Call count remains 1!
    expect(result2).toEqual({
      prNumber: 99,
      url: "https://github.com/org/repo/pull/99",
    });
  });

  it("executeWithLedger records failure when external call throws", async () => {
    const { ledgerRepo, run } = setupDb();

    let shouldFail = true;
    const failingMutation = async () => {
      if (shouldFail) {
        throw new Error("External API 503 Service Unavailable");
      }
      return {
        externalId: "ext-1",
        result: { ok: true },
      };
    };

    // First execution fails
    await expect(
      ledgerRepo.executeWithLedger(run.id, "external_api", failingMutation),
    ).rejects.toThrow("External API 503 Service Unavailable");

    const failedOp = ledgerRepo.getOperation(run.id, "external_api");
    expect(failedOp?.status).toBe("failed");
    expect(failedOp?.error).toContain("503");

    // Retry after recovery: succeeds
    shouldFail = false;
    const successResult = await ledgerRepo.executeWithLedger(
      run.id,
      "external_api",
      failingMutation,
    );
    expect(successResult).toEqual({ ok: true });

    const recoveredOp = ledgerRepo.getOperation(run.id, "external_api");
    expect(recoveredOp?.status).toBe("completed");
    expect(recoveredOp?.error).toBeNull();
  });
});
