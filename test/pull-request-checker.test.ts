// test/pull-request-checker.test.ts — Unit and integration tests for PR status checking and worker polling (#271).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { handleGetRun } from "../src/http/runs-controller.js";
import { RateLimitedError } from "../src/model-gateway.js";
import type {
  GetPullRequestStateInput,
  Provider,
  PullRequestState,
} from "../src/providers/contract.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import { PullRequestChecker } from "../src/pull-request-checker.js";
import * as runs from "../src/runs.js";
import type { Project } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";

describe("PullRequestChecker (#271)", () => {
  let tempDir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    previousDataDir = process.env.X_FACTORY_DATA_DIR;
    tempDir = await mkdtemp(path.join(tmpdir(), "xf-pr-checker-"));
    process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
    else process.env.X_FACTORY_DATA_DIR = previousDataDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  function createTestHarness(options?: {
    stubState?: PullRequestState | null;
    stubError?: Error;
    initialTime?: number;
    providerId?: string;
  }) {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const repos = createRepositories(db);

    let currentTime = options?.initialTime ?? Date.now();
    const clock = {
      now: () => currentTime,
      advance: (ms: number) => {
        currentTime += ms;
      },
      setTime: (t: number) => {
        currentTime = t;
      },
    };

    let stateResponse: PullRequestState | null =
      options?.stubState !== undefined
        ? options.stubState
        : {
            status: "open",
            url: "https://github.com/org/repo/pull/10",
          };
    let errorToThrow: Error | undefined = options?.stubError;
    let callCount = 0;
    const recordedCalls: Array<GetPullRequestStateInput> = [];

    const providerId = options?.providerId ?? "github";
    const stubProvider: Provider = {
      id: providerId,
      displayName: "Stub Host",
      iconRef: "provider-stub",
      roles: ["gitHost"],
      configSchema: z.object({
        repository: z.string().optional(),
      }),
      verifyCredentials: async () => ({
        ok: true,
        status: "ok",
        warnings: [],
      }),
      toUserError: (err: unknown, context) => ({
        code: "UNKNOWN",
        message: String(err),
        context,
      }),
      async getPullRequestState(_config, input) {
        callCount++;
        recordedCalls.push(input);
        if (errorToThrow) throw errorToThrow;
        return stateResponse;
      },
    };

    const registry: ProviderRegistry = new Map([[providerId, stubProvider]]);

    const testProject: Project = {
      id: "test-proj",
      name: "Test Project",
      defaultBranch: "main",
      workspacePath: tempDir,
      repositoryPath: tempDir,
      issueTracker: { provider: "github" },
      testCommand: "bun test",
      repositories: [
        {
          id: "repo-1",
          name: "org/repo",
          path: tempDir,
          defaultBranch: "main",
        },
      ],
      connections: [
        {
          providerId,
          roles: ["gitHost"],
          config: { repository: "org/repo" },
        },
      ],
    };

    const checker = new PullRequestChecker({
      repos,
      registry,
      clock,
      resolveProject: async () => testProject,
      pollIntervalMs: 5 * 60 * 1000,
      thirtyDaysMs: 30 * 24 * 60 * 60 * 1000,
      baseBackoffMs: 2000,
      maxBackoffMs: 60_000,
      random: () => 0.5, // deterministic jitter (multiplier = 1.0)
    });

    const createRun = (params?: {
      id?: string;
      status?: "pr_created" | "executing";
      createdAt?: string;
      prUrl?: string;
    }) => {
      const runId = params?.id ?? "run-pr-1";
      repos.runs.create({
        id: runId,
        projectId: testProject.id,
        projectName: testProject.name,
        ticket: { id: "T-10", title: "Add feature", acceptanceCriteria: [] },
        plan: "Plan",
        branch: "factory/t-10",
        status: params?.status ?? "pr_created",
        artifactsDir: path.join(tempDir, runId),
        worktreePath: path.join(tempDir, runId),
      });

      // Update PR url and createdAt
      repos.runs.update(runId, {
        pullRequest: {
          url: params?.prUrl ?? "https://github.com/org/repo/pull/10",
          branch: "factory/t-10",
          baseBranch: "main",
          title: "PR Title",
        },
      });

      // Directly update created_at in database if specified
      if (params?.createdAt) {
        db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(
          params.createdAt,
          runId,
        );
      }

      const created = repos.runs.get(runId);
      if (!created) throw new Error(`Run ${runId} was not created`);
      return created;
    };

    return {
      db,
      repos,
      clock,
      checker,
      testProject,
      createRun,
      setState: (s: PullRequestState | null) => {
        stateResponse = s;
        errorToThrow = undefined;
      },
      setError: (err: Error) => {
        errorToThrow = err;
      },
      getCallCount: () => callCount,
      getRecordedCalls: () => recordedCalls,
    };
  }

  it("1. detects PR merged, records pr_merged event, and run status does not change", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "merged",
        url: "https://github.com/org/repo/pull/10",
        mergedAt: "2026-10-12T10:00:00Z",
        mergedBy: "lead-reviewer",
      },
    });

    const run = harness.createRun();
    expect(run.status).toBe("pr_created");

    const result = await harness.checker.checkRun(run.id);
    expect(result.checked).toBe(true);
    if (!result.checked || result.status !== "merged") {
      throw new Error("Expected checked to be true and status merged");
    }

    expect(result.status).toBe("merged");
    expect(result.outcome).toEqual({
      status: "merged",
      state: "merged",
      url: "https://github.com/org/repo/pull/10",
      mergedAt: "2026-10-12T10:00:00Z",
      mergedBy: "lead-reviewer",
    });

    // Run status must NOT change (the state machine is untouched)
    const refreshed = runs.getRun(harness.repos, run.id);
    expect(refreshed?.status).toBe("pr_created");
    expect(refreshed?.pullRequestOutcome).toEqual({
      status: "merged",
      state: "merged",
      url: "https://github.com/org/repo/pull/10",
      mergedAt: "2026-10-12T10:00:00Z",
      mergedBy: "lead-reviewer",
    });

    // Event was recorded durably
    const events = harness.repos.events.getEventsForRun(run.id);
    const mergedEvent = events.find((e) => e.type === "pr_merged");
    expect(mergedEvent).toBeDefined();
    expect(mergedEvent?.payload).toEqual({
      url: "https://github.com/org/repo/pull/10",
      mergedAt: "2026-10-12T10:00:00Z",
      mergedBy: "lead-reviewer",
    });

    // Checking again returns already_completed and makes no host calls
    const callsBefore = harness.getCallCount();
    const secondResult = await harness.checker.checkRun(run.id);
    expect(secondResult.checked).toBe(false);
    if (secondResult.checked) throw new Error("Expected false");
    expect(secondResult.reason).toBe("already_completed");
    expect(harness.getCallCount()).toBe(callsBefore);
  });

  it("2. detects PR closed without merging, records pr_closed event, and run status does not change", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "closed",
        url: "https://github.com/org/repo/pull/10",
        closedAt: "2026-10-12T11:00:00Z",
      },
    });

    const run = harness.createRun();
    const result = await harness.checker.checkRun(run.id);
    expect(result.checked).toBe(true);
    if (!result.checked || result.status !== "closed") {
      throw new Error("Expected checked to be true and status closed");
    }

    expect(result.status).toBe("closed");
    expect(result.outcome).toEqual({
      status: "closed",
      state: "closed",
      url: "https://github.com/org/repo/pull/10",
      closedAt: "2026-10-12T11:00:00Z",
    });

    // Run status must NOT change
    const refreshed = runs.getRun(harness.repos, run.id);
    expect(refreshed?.status).toBe("pr_created");
    expect(refreshed?.pullRequestOutcome?.status).toBe("closed");

    // Event was recorded
    const events = harness.repos.events.getEventsForRun(run.id);
    const closedEvent = events.find((e) => e.type === "pr_closed");
    expect(closedEvent).toBeDefined();
    expect(closedEvent?.payload).toEqual({
      url: "https://github.com/org/repo/pull/10",
      closedAt: "2026-10-12T11:00:00Z",
    });
  });

  it("3. when PR is still open, records no event and schedules next check 5 minutes later", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "open",
        url: "https://github.com/org/repo/pull/10",
      },
    });

    const run = harness.createRun();
    const beforeCheck = harness.clock.now();
    const result = await harness.checker.checkRun(run.id);

    expect(result.checked).toBe(true);
    if (!result.checked || result.status !== "open") {
      throw new Error("Expected checked to be true and status open");
    }
    expect(result.status).toBe("open");
    expect(result.nextDueAt).toBe(beforeCheck + 5 * 60 * 1000);

    // No outcome events recorded
    const events = harness.repos.events.getEventsForRun(run.id);
    expect(
      events.filter((e) => e.type === "pr_merged" || e.type === "pr_closed"),
    ).toHaveLength(0);

    const refreshed = runs.getRun(harness.repos, run.id);
    expect(refreshed?.pullRequestOutcome).toBeUndefined();
  });

  it("4. handles host error and backoff (Retry-After and exponential backoff)", async () => {
    const harness = createTestHarness();
    const run = harness.createRun();

    // 4a. Rate limit error with retry delay
    harness.setError(
      new RateLimitedError("GitHub 429 rate limit exceeded", 45_000),
    );
    const now = harness.clock.now();
    const res1 = await harness.checker.checkRun(run.id);

    expect(res1.checked).toBe(false);
    if (
      res1.checked ||
      (res1.reason !== "error" && res1.reason !== "rate_limited")
    ) {
      throw new Error("Expected checked to be false with error");
    }
    expect(res1.reason).toBe("error");
    expect(res1.nextDueAt).toBe(now + 45_000);

    // Calling before backoff window expires returns rate_limited and skips host call
    const callCountBefore = harness.getCallCount();
    const resSkipped = await harness.checker.checkRun(run.id);
    expect(resSkipped.checked).toBe(false);
    if (resSkipped.checked) throw new Error("Expected false");
    expect(resSkipped.reason).toBe("rate_limited");
    expect(harness.getCallCount()).toBe(callCountBefore);

    // 4b. Advance past backoff window: now generic 500 error
    harness.clock.advance(50_000);
    harness.setError(new Error("500 Internal Server Error"));
    const now2 = harness.clock.now();
    const res2 = await harness.checker.checkRun(run.id);

    expect(res2.checked).toBe(false);
    if (
      res2.checked ||
      (res2.reason !== "error" && res2.reason !== "rate_limited")
    ) {
      throw new Error("Expected false with error");
    }
    expect(res2.reason).toBe("error");
    // With error count 2 and deterministic random = 0.5 (multiplier 1.0):
    // 2000 * 2^1 = 4000ms
    expect(res2.nextDueAt).toBe(now2 + 4000);

    // 4c. Successful check resets consecutive error count and sets next poll in 5 min
    harness.clock.advance(5000);
    harness.setState({
      status: "open",
      url: "https://github.com/org/repo/pull/10",
    });
    const res3 = await harness.checker.checkRun(run.id);

    expect(res3.checked).toBe(true);
    if (!res3.checked || res3.status !== "open") {
      throw new Error("Expected open");
    }
    expect(res3.nextDueAt).toBe(harness.clock.now() + 5 * 60 * 1000);
  });

  it("5. repeat detection is a no-op and enforced atomically", async () => {
    const harness = createTestHarness();
    const run = harness.createRun();

    // Append merged event
    const firstEvent = harness.repos.events.appendEvent(run.id, "pr_merged", {
      url: "https://github.com/org/repo/pull/10",
      mergedAt: "2026-10-12T10:00:00Z",
      mergedBy: "reviewer-1",
    });

    // Repeating appendEvent for pr_merged or pr_closed returns the existing event
    const secondEvent = harness.repos.events.appendEvent(run.id, "pr_merged", {
      url: "https://github.com/org/repo/pull/10",
      mergedAt: "2026-10-12T10:00:00Z",
      mergedBy: "reviewer-1",
    });
    expect(secondEvent.id).toBe(firstEvent.id);

    // Even if another process attempted to append pr_closed, the partial unique index prevents duplicates
    const thirdEvent = harness.repos.events.appendEvent(run.id, "pr_closed", {
      url: "https://github.com/org/repo/pull/10",
      closedAt: "2026-10-12T10:05:00Z",
    });
    expect(thirdEvent.id).toBe(firstEvent.id);

    // Exactly one outcome event exists
    const events = harness.repos.events.getEventsForRun(run.id);
    expect(
      events.filter((e) => e.type === "pr_merged" || e.type === "pr_closed"),
    ).toHaveLength(1);
  });

  it("6. stops polling runs older than 30 days", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "merged",
        url: "https://github.com/org/repo/pull/10",
      },
    });

    const thirtyOneDaysAgo = new Date(
      harness.clock.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const run = harness.createRun({ createdAt: thirtyOneDaysAgo });

    // checkRun returns expired_30_days and makes NO host calls
    const res = await harness.checker.checkRun(run.id);
    expect(res.checked).toBe(false);
    if (res.checked) throw new Error("Expected false");
    expect(res.reason).toBe("expired_30_days");
    expect(harness.getCallCount()).toBe(0);

    // pollDueRuns skips the run
    const pollResults = await harness.checker.pollDueRuns();
    expect(pollResults).toHaveLength(0);
    expect(harness.getCallCount()).toBe(0);
  });

  it("7. Worker processes check_pr command and marks it completed", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "merged",
        url: "https://github.com/org/repo/pull/10",
        mergedAt: "2026-10-12T10:00:00Z",
      },
    });

    const run = harness.createRun();

    // Enqueue check_pr command
    const queued = runs.requestPullRequestCheck(harness.repos, run.id);
    expect(queued).toBe(true);

    const worker = new Worker({
      workerId: "test-pr-worker",
      db: harness.db,
      prChecker: harness.checker,
      clock: harness.clock,
    });

    // Execute the command via worker
    const processedCommands = await worker.stepCommandOnce();
    expect(processedCommands).toHaveLength(1);
    expect(processedCommands[0]?.command).toBe("check_pr");

    const commandId = processedCommands[0]?.id;
    if (!commandId) throw new Error("No command id");
    const cmd = harness.repos.commands.getCommand(commandId);
    expect(cmd?.status).toBe("completed");

    // The PR outcome was recorded by the check
    const refreshed = runs.getRun(harness.repos, run.id);
    expect(refreshed?.pullRequestOutcome?.status).toBe("merged");
  });

  it("8. Opening a pr_created run enqueues a check_pr command; API process makes no host call", async () => {
    const harness = createTestHarness();
    const run = harness.createRun();

    expect(harness.getCallCount()).toBe(0);
    expect(harness.repos.commands.hasActiveCommand(run.id, "check_pr")).toBe(
      false,
    );

    // API controller handleGetRun
    const res = handleGetRun(harness.repos, run.id);
    expect(res.status).toBe(200);

    // Command was enqueued
    expect(harness.repos.commands.hasActiveCommand(run.id, "check_pr")).toBe(
      true,
    );

    // Zero host calls were made by the API process!
    expect(harness.getCallCount()).toBe(0);

    // Opening it again does not insert a duplicate command
    const activeBefore = harness.repos.commands.hasActiveCommand(
      run.id,
      "check_pr",
    );
    expect(activeBefore).toBe(true);
    const res2 = handleGetRun(harness.repos, run.id);
    expect(res2.status).toBe(200);
    expect(harness.getCallCount()).toBe(0);
  });

  it("9. Worker stepPrCheckOnce checks due runs in pr_created", async () => {
    const harness = createTestHarness({
      stubState: {
        status: "merged",
        url: "https://github.com/org/repo/pull/10",
      },
    });

    const run = harness.createRun();

    const worker = new Worker({
      workerId: "test-pr-poll-worker",
      db: harness.db,
      prChecker: harness.checker,
      clock: harness.clock,
    });

    const results = await worker.stepPrCheckOnce();
    expect(results).toHaveLength(1);
    expect(results[0]?.checked).toBe(true);
    if (!results[0]?.checked) throw new Error("Expected checked");
    expect(results[0].status).toBe("merged");

    const refreshed = runs.getRun(harness.repos, run.id);
    expect(refreshed?.pullRequestOutcome?.status).toBe("merged");
  });
});
