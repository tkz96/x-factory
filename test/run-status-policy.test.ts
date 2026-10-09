// test/run-status-policy.test.ts — The shared run-status policy matches the server's
// run-action guards, and every client view consumes the one shared policy (#170).

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";
import {
  ACTIONS_BY_STATUS,
  ACTIVE_RUN_STATUSES,
  allowedActionsFor,
  canRunAction,
  EXECUTABLE_RUN_STATUSES,
  type RunAction,
  runStatusLabel,
  STATUS_TO_STAGE,
  STOPPABLE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../src/shared/run-status-policy.js";
import type { RunStatus } from "../src/shared/types.js";

const ALL_RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "preparing",
  "understanding",
  "awaiting_understanding_approval",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "awaiting_review",
  "ready_for_pr",
  "pr_created",
  "recovery_required",
  "failed",
  "stopped",
];

/**
 * Literal expectation: which run actions the server's guards accept (HTTP 2xx)
 * in each status. Derived by exercising the real guards through `handleApi`,
 * not by reading the shared table. The `abort` transition action is excluded
 * because the server maps it directly onto `stop`'s guard.
 */
const EXPECTED_GUARD_ACCEPTANCE: Record<RunStatus, readonly RunAction[]> = {
  queued: ["stop"],
  preparing: ["stop"],
  understanding: ["stop"],
  awaiting_understanding_approval: ["approve", "restart", "chat", "stop"],
  planning: ["stop"],
  awaiting_plan_approval: ["approve", "restart", "chat", "stop"],
  executing: ["steer", "stop"],
  awaiting_review: ["approve", "requeue", "chat", "stop"],
  ready_for_pr: ["deliver"],
  pr_created: [],
  recovery_required: ["resume", "abandon"],
  failed: [],
  stopped: ["stop"],
};

/**
 * Literal expectation: the shared client-facing actions table. Identical to
 * the server's guard acceptance except for documented idempotent no-ops, which
 * gate no UI and therefore stay out of the table.
 */
const EXPECTED_ACTIONS_BY_STATUS: Record<RunStatus, readonly RunAction[]> = {
  queued: ["stop"],
  preparing: ["stop"],
  understanding: ["stop"],
  awaiting_understanding_approval: ["approve", "restart", "chat", "stop"],
  planning: ["stop"],
  awaiting_plan_approval: ["approve", "restart", "chat", "stop"],
  executing: ["steer", "stop"],
  awaiting_review: ["approve", "requeue", "chat", "stop"],
  ready_for_pr: ["deliver"],
  pr_created: [],
  recovery_required: ["resume", "abandon"],
  failed: [],
  stopped: [],
};

/**
 * Guard acceptance the server treats as an idempotent no-op rather than an
 * offered action: stopping an already-stopped run returns the run unchanged.
 */
const IDEMPOTENT_NO_OPS: ReadonlyArray<[RunStatus, RunAction]> = [
  ["stopped", "stop"],
];

/** Every guarded run action, each exercised through its own HTTP route. */
const GUARDED_ACTION_ENDPOINTS: Record<RunAction, (runId: string) => Request> =
  {
    approve: (runId) => transitionRequest(runId, "approve"),
    restart: (runId) => transitionRequest(runId, "restart"),
    requeue: (runId) => transitionRequest(runId, "requeue"),
    stop: (runId) => postRequest(`/api/runs/${runId}/stop`),
    deliver: (runId) => postRequest(`/api/runs/${runId}/pr`),
    resume: (runId) => postRequest(`/api/runs/${runId}/resume`),
    abandon: (runId) => postRequest(`/api/runs/${runId}/abandon`),
    chat: (runId) =>
      postRequest(`/api/runs/${runId}/chat`, { message: "ping" }),
    steer: (runId) =>
      postRequest(`/api/runs/${runId}/steer`, { message: "ping" }),
  };

function postRequest(urlPath: string, body?: unknown): Request {
  return new Request(`http://localhost:3777${urlPath}`, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

function transitionRequest(runId: string, action: string): Request {
  return postRequest(`/api/runs/${runId}/transitions`, { action });
}

function sorted(actions: readonly string[]): string[] {
  return [...actions].sort();
}

describe("Shared run-status policy matches server guards (#170)", () => {
  let db: Database | undefined;
  let runRepo: RunRepository;
  let originalDataDir: string | undefined;

  beforeAll(() => {
    // Point chat at a data dir whose settings.json names an unregistered
    // provider, so the guard test stays offline: the model lookup fails and
    // chatWithRun degrades to its fallback reply instead of calling a real
    // provider.
    const tempDir = mkdtempSync(path.join(tmpdir(), "run-status-policy-"));
    writeFileSync(
      path.join(tempDir, "settings.json"),
      JSON.stringify({
        models: {
          sessionA: {
            provider: "unregistered-test-provider",
            model: "unregistered-test-model",
          },
        },
      }),
    );
    originalDataDir = process.env.X_FACTORY_DATA_DIR;
    process.env.X_FACTORY_DATA_DIR = tempDir;
  });

  afterAll(() => {
    if (originalDataDir === undefined) {
      delete process.env.X_FACTORY_DATA_DIR;
    } else {
      process.env.X_FACTORY_DATA_DIR = originalDataDir;
    }
    setDbForTesting(null);
    db?.close();
  });

  // setDbForTesting stores the database in an AsyncLocalStorage context, so
  // it must be called from the test body, not from beforeAll.
  function setupTestDb(): void {
    db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
    runRepo = new RunRepository(db);
  }

  function createRunAtStatus(id: string, status: RunStatus): void {
    runRepo.create({
      id,
      projectId: "proj-policy",
      projectName: "Policy Test Project",
      ticket: {
        id: "POL-1",
        title: "Policy guard exercise",
        acceptanceCriteria: ["Guards match the shared table"],
      },
      plan: "Step 1",
      branch: "factory/POL-1",
      status,
      artifactsDir: `/tmp/artifacts/${id}`,
      worktreePath: `/tmp/worktrees/${id}`,
    });
  }

  it("exercised server guards accept exactly the literal per-status actions", async () => {
    setupTestDb();
    const exercised: Partial<Record<RunStatus, string[]>> = {};

    for (const status of ALL_RUN_STATUSES) {
      exercised[status] = [];
      for (const action of Object.keys(
        GUARDED_ACTION_ENDPOINTS,
      ) as RunAction[]) {
        const runId = `run-guard-${status}-${action}`;
        createRunAtStatus(runId, status);

        const req = GUARDED_ACTION_ENDPOINTS[action](runId);
        const res = await handleApi(req, new URL(req.url));
        if (res.status >= 200 && res.status < 300) {
          exercised[status]?.push(action);
        }
      }
    }

    for (const status of ALL_RUN_STATUSES) {
      expect({ status, exercised: sorted(exercised[status] ?? []) }).toEqual({
        status,
        exercised: sorted(EXPECTED_GUARD_ACCEPTANCE[status]),
      });
    }
  });

  it("guard acceptance equals the shared table plus the idempotent no-ops", () => {
    for (const status of ALL_RUN_STATUSES) {
      const noOps = IDEMPOTENT_NO_OPS.filter(
        ([noOpStatus]) => noOpStatus === status,
      ).map(([, action]) => action);
      expect(sorted([...EXPECTED_GUARD_ACCEPTANCE[status]])).toEqual(
        sorted([...EXPECTED_ACTIONS_BY_STATUS[status], ...noOps]),
      );
    }
  });

  it("the shared actions table equals the literal expectation", () => {
    expect(ACTIONS_BY_STATUS).toEqual(EXPECTED_ACTIONS_BY_STATUS);
  });

  it("chat is allowed at exactly the approval gates and review, and its guard names the chat action", () => {
    expect(
      ALL_RUN_STATUSES.filter((status) => canRunAction(status, "chat")),
    ).toEqual([
      "awaiting_understanding_approval",
      "awaiting_plan_approval",
      "awaiting_review",
    ]);
    // chatWithRun must check "chat", not "approve": the two share statuses today,
    // so only the action name keeps a future policy change from drifting apart.
    const source = readFileSync(
      path.join(process.cwd(), "src", "runs.ts"),
      "utf-8",
    );
    const start = source.indexOf("export async function chatWithRun(");
    const end = source.indexOf('eventRepo.appendEvent(id, "chat_user"', start);
    const guard = source.slice(start, end);
    expect(guard).toContain('canRunAction(run.status, "chat")');
    expect(guard).not.toContain('"approve"');
  });

  it("allowedActionsFor returns the table row, or [] for an unknown status", () => {
    expect(allowedActionsFor("awaiting_review")).toEqual([
      "approve",
      "requeue",
      "chat",
      "stop",
    ]);
    expect(allowedActionsFor("pr_created")).toEqual([]);
    expect(allowedActionsFor("not_a_status" as RunStatus)).toEqual([]);
  });

  it("the shared sets equal their literal definitions", () => {
    expect(sorted([...TERMINAL_RUN_STATUSES])).toEqual(
      sorted(["pr_created", "failed", "stopped"]),
    );
    expect(sorted([...ACTIVE_RUN_STATUSES])).toEqual(
      sorted([
        "queued",
        "preparing",
        "understanding",
        "awaiting_understanding_approval",
        "planning",
        "awaiting_plan_approval",
        "executing",
        "awaiting_review",
        "ready_for_pr",
        "recovery_required",
      ]),
    );
    expect(sorted([...STOPPABLE_RUN_STATUSES])).toEqual(
      sorted([
        "queued",
        "preparing",
        "understanding",
        "awaiting_understanding_approval",
        "planning",
        "awaiting_plan_approval",
        "executing",
        "awaiting_review",
      ]),
    );
    expect(sorted([...EXECUTABLE_RUN_STATUSES])).toEqual(
      sorted(["queued", "preparing", "understanding", "planning", "executing"]),
    );
  });

  it("the status→stage map equals the literal expectation", () => {
    expect(STATUS_TO_STAGE).toEqual({
      queued: "prepare",
      preparing: "prepare",
      understanding: "understand",
      awaiting_understanding_approval: "understand",
      planning: "plan",
      awaiting_plan_approval: "plan",
      executing: "execute",
      awaiting_review: "review",
      ready_for_pr: "deliver",
      pr_created: "deliver",
      recovery_required: null,
      failed: null,
      stopped: null,
    });
  });

  it("every status has the literal display label", () => {
    const expectedLabels: Record<RunStatus, string> = {
      queued: "queued",
      preparing: "preparing",
      understanding: "understanding",
      awaiting_understanding_approval: "awaiting understanding approval",
      planning: "planning",
      awaiting_plan_approval: "awaiting plan approval",
      executing: "executing",
      awaiting_review: "awaiting review",
      ready_for_pr: "ready for pr",
      pr_created: "pr created",
      recovery_required: "recovery required",
      failed: "failed",
      stopped: "stopped",
    };
    for (const status of ALL_RUN_STATUSES) {
      expect(runStatusLabel(status)).toBe(expectedLabels[status]);
    }
  });
});

describe("One shared run-status policy import everywhere (#170)", () => {
  const repoRoot = process.cwd();

  function sourceFilesIn(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...sourceFilesIn(fullPath));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("the state machine no longer exists outside src/shared", () => {
    expect(() =>
      readFileSync(path.join(repoRoot, "src", "state-machine.ts")),
    ).toThrow();
    const sharedDir = path.join(repoRoot, "src", "shared");
    for (const file of sourceFilesIn(path.join(repoRoot, "src"))) {
      if (file.startsWith(sharedDir)) continue;
      const content = readFileSync(file, "utf-8");
      expect(content).not.toContain("state-machine.js");
    }
  });

  it("no frontend file defines its own run-status set, map, or label", () => {
    const frontendDir = path.join(repoRoot, "src", "frontend");
    const bannedDefinitions = [
      "new Set<RunStatus>",
      "STATUS_TO_STAGE:",
      "TERMINAL_STATUSES",
      "STOPPABLE_RUN_STATUSES =",
      "TERMINAL_RUN_STATUSES =",
      "ACTIVE_RUN_STATUSES =",
      "status.replace(/_/g",
    ];
    for (const file of sourceFilesIn(frontendDir)) {
      const content = readFileSync(file, "utf-8");
      for (const banned of bannedDefinitions) {
        const found = content.includes(banned);
        expect({ file, banned, found }).toEqual({
          file,
          banned,
          found: false,
        });
      }
    }
  });

  it("no frontend or http file hand-rolls a status chain or status-literal array", () => {
    const statusLiteral = `"(?:${ALL_RUN_STATUSES.join("|")})"`;
    const chain = new RegExp(
      `(?:===|!==)\\s*${statusLiteral}\\s*(?:\\|\\||&&)\\s*[\\w.?]+\\s*(?:===|!==)\\s*${statusLiteral}`,
    );
    const inlineArray = new RegExp(
      `\\[\\s*${statusLiteral}(?:\\s*,\\s*${statusLiteral})+`,
    );
    for (const dir of ["frontend", "http"]) {
      for (const file of sourceFilesIn(path.join(repoRoot, "src", dir))) {
        const content = readFileSync(file, "utf-8");
        expect({ file, chain: chain.test(content) }).toEqual({
          file,
          chain: false,
        });
        expect({ file, inlineArray: inlineArray.test(content) }).toEqual({
          file,
          inlineArray: false,
        });
      }
    }
  });

  it("every client consumer imports the shared policy module", () => {
    const consumers: Record<string, string[]> = {
      "src/frontend/lib/run-state.ts": ["TERMINAL_RUN_STATUSES"],
      "src/frontend/components/runs/WorkflowStepper.tsx": ["STATUS_TO_STAGE"],
      "src/frontend/components/history/RunHistoryCard.tsx": ["runStatusLabel"],
      "src/frontend/components/AppShell.tsx": ["STOPPABLE_RUN_STATUSES"],
      "src/frontend/views/RunsView.tsx": ["ACTIVE_RUN_STATUSES"],
      "src/frontend/views/HistoryView.tsx": ["ACTIVE_RUN_STATUSES"],
      "src/frontend/components/runs/RunChat.tsx": ["canRunAction"],
    };
    for (const [relativePath, names] of Object.entries(consumers)) {
      const content = readFileSync(path.join(repoRoot, relativePath), "utf-8");
      expect(content).toContain("shared/run-status-policy.js");
      for (const name of names) {
        expect({ relativePath, name, found: content.includes(name) }).toEqual({
          relativePath,
          name,
          found: true,
        });
      }
    }
  });
});
