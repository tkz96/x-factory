// test/one-active-run-per-ticket.test.ts — One active run per ticket (#255).
//
// The seam is the HTTP API: POST /api/runs through the real route table over an
// in-memory database, a real (temporary) git repository and a temporary data
// dir — so the files a refused attempt must not leave behind are visible here.
// "Active" is read from the shared policy and never re-declared: the loop over
// every status asks ACTIVE_RUN_STATUSES which answer is correct, so a guard with
// a list of its own cannot agree with it by luck.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Repositories } from "../src/composition-root.js";
import { getProjectRunsDir } from "../src/paths.js";
import { execStrict } from "../src/proc.js";
import { ACTIVE_RUN_CONFLICT_CODE } from "../src/shared/run-creation.js";
import { ACTIVE_RUN_STATUSES } from "../src/shared/run-status-policy.js";
import type { RunStatus } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { dispatchHttp } from "./helpers/http-dispatch.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { withReadyModelRoles } from "./helpers/resolved-model.js";

const PROJECT_ID = "proj-one-active";
const DEAD_DISK_PROJECT_ID = "proj-one-active-dead-disk";

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

let repoDir: string;

beforeAll(async () => {
  repoDir = await mkdtemp(path.join(tmpdir(), "xf-one-active-repo-"));
  await execStrict("git", ["init", "-b", "main"], {
    envPolicy: "inherit",
    cwd: repoDir,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Tester"], {
    envPolicy: "inherit",
    cwd: repoDir,
  });
  await execStrict("git", ["config", "user.email", "tester@xfactory.local"], {
    envPolicy: "inherit",
    cwd: repoDir,
  });
  await writeFile(path.join(repoDir, "README.md"), "# Init\n");
  await execStrict("git", ["add", "."], {
    envPolicy: "inherit",
    cwd: repoDir,
  });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: repoDir,
  });
  ensureProject(PROJECT_ID, { repositoryPath: repoDir });
});

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

function createRunRequest(
  ticketId: string,
  overrides: { projectId?: string; plan?: string } = {},
): Request {
  return new Request("http://localhost:3777/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: overrides.projectId ?? PROJECT_ID,
      ticketId,
      ticketTitle: `Ticket ${ticketId}`,
      plan: overrides.plan ?? "1. Understand\n2. Implement\n3. Verify",
    }),
  });
}

/** Plants an existing run for `ticketId` at `status`, as a real one looks. */
function plantRun(
  repos: Repositories,
  ticketId: string,
  status: RunStatus,
): string {
  const id = `existing-${status}-${ticketId}`;
  repos.runs.create({
    id,
    projectId: PROJECT_ID,
    projectName: "One Active Run",
    ticket: {
      id: ticketId,
      title: `Ticket ${ticketId}`,
      acceptanceCriteria: [],
    },
    plan: "Existing plan",
    branch: `factory/${ticketId}`,
    status,
    artifactsDir: path.join(getProjectRunsDir(PROJECT_ID), id),
    worktreePath: path.join(getProjectRunsDir(PROJECT_ID), id, "worktree"),
  });
  return id;
}

/** Every file under `dir` (recursively) whose text mentions `needle`. */
async function filesMentioning(dir: string, needle: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesMentioning(full, needle)));
    } else if (entry.isFile()) {
      if ((await readFile(full, "utf-8")).includes(needle)) found.push(full);
    }
  }
  return found;
}

/** Every file under `dir`, keyed by its path relative to `dir`, with its text. */
async function snapshotFiles(dir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, text] of Object.entries(await snapshotFiles(full))) {
        snapshot[path.join(entry.name, name)] = text;
      }
    } else if (entry.isFile()) {
      snapshot[entry.name] = await readFile(full, "utf-8");
    }
  }
  return snapshot;
}

function countJobs(repos: Repositories): number {
  const row = repos.db.query("SELECT COUNT(*) AS count FROM jobs;").get() as {
    count: number;
  };
  return row.count;
}

describe("one active run per ticket (#255)", () => {
  it("refuses exactly the shared policy's active statuses, and allows every terminal one", async () => {
    await withReadyModelRoles(async () => {
      const outcomes: Record<string, number> = {};

      for (const status of ALL_RUN_STATUSES) {
        const repos = createTestRepositories();
        const ticketId = `T-status-${status}`;
        plantRun(repos, ticketId, status);
        const res = await dispatchHttp(createRunRequest(ticketId), repos);
        outcomes[status] = res.status;
      }

      // The expectation is computed from the shared set, so a guard with a list
      // of its own — or one that forgets recovery_required — cannot match it.
      expect(outcomes).toEqual(
        Object.fromEntries(
          ALL_RUN_STATUSES.map((status) => [
            status,
            ACTIVE_RUN_STATUSES.has(status) ? 409 : 201,
          ]),
        ),
      );
    });
  });

  it("reads the shared active set in the guard and declares no status of its own", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "db", "run-repository.ts"),
      "utf-8",
    );
    const body = /findActiveRunForTicket\([\s\S]*?\n {2}\}/.exec(source)?.[0];
    if (body === undefined) {
      throw new Error(
        "Could not find `findActiveRunForTicket` in src/db/run-repository.ts; update this pin to its new location.",
      );
    }
    expect(body).toContain("ACTIVE_RUN_STATUSES");
    for (const status of ALL_RUN_STATUSES) {
      expect(body).not.toContain(`"${status}"`);
    }
  });

  it("checks the active run and inserts it in one immediate write transaction", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "runs.ts"),
      "utf-8",
    );
    const tx =
      /const insertActiveRun = db\.transaction\([\s\S]*?\n {2}\}\);[\s\S]*?createdRun = insertActiveRun\.immediate\(\);/.exec(
        source,
      )?.[0];
    if (tx === undefined) {
      throw new Error(
        "Could not find the run-creation transaction in src/runs.ts; update this pin to its new location.",
      );
    }
    // The guard and the insert live in that one transaction, and the transaction
    // is the immediate one: it takes the write lock before its first read.
    expect(tx).toContain("refuseIfActive();");
    expect(source).toMatch(
      /const refuseIfActive = \(\) => \{\n\s+const active = runRepo\.findActiveRunForTicket\(/,
    );
    expect(tx).toContain("runRepo.create(");
    expect(tx).toContain("insertActiveRun.immediate()");
  });

  it("refuses a second active run with 409 carrying the existing run's id, and writes no files for it", async () => {
    await withReadyModelRoles(async () => {
      const repos = createTestRepositories();
      const ticketId = "T-255-refused";
      const marker = "REFUSED-ATTEMPT-MARKER";

      const first = await dispatchHttp(createRunRequest(ticketId), repos);
      expect(first.status).toBe(201);
      const existing = (await first.json()) as { id: string };

      const runsDir = getProjectRunsDir(PROJECT_ID);
      const before = (await readdir(runsDir)).sort();

      const second = await dispatchHttp(
        createRunRequest(ticketId, { plan: `${marker} never on disk` }),
        repos,
      );
      expect(second.status).toBe(409);
      const conflict = (await second.json()) as {
        error: string;
        code: string;
        runId: string;
      };
      expect(conflict.runId).toBe(existing.id);
      expect(conflict.code).toBe(ACTIVE_RUN_CONFLICT_CODE);
      expect(conflict.error).toContain(existing.id);

      // One run, and exactly the files the first attempt wrote.
      expect(repos.runs.list()).toHaveLength(1);
      expect((await readdir(runsDir)).sort()).toEqual(before);
      expect(await filesMentioning(runsDir, marker)).toEqual([]);
    });
  });

  it("two concurrent creates for one ticket produce exactly one run; the loser gets the winner's id and leaves no files", async () => {
    await withReadyModelRoles(async () => {
      const repos = createTestRepositories();
      const ticketId = "T-255-race";
      const planA = "RACE-ATTEMPT-A-MARKER";
      const planB = "RACE-ATTEMPT-B-MARKER";

      const [a, b] = await Promise.all([
        dispatchHttp(createRunRequest(ticketId, { plan: planA }), repos),
        dispatchHttp(createRunRequest(ticketId, { plan: planB }), repos),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      const loser = a.status === 201 ? b : a;
      const winnerBody = (await winner.json()) as { id: string };
      const loserBody = (await loser.json()) as { runId: string };
      const winnerPlan = a.status === 201 ? planA : planB;
      const loserPlan = a.status === 201 ? planB : planA;

      expect(loserBody.runId).toBe(winnerBody.id);
      expect(repos.runs.list()).toHaveLength(1);

      // Only the winner's plan reached the disk; the loser left nothing behind.
      const runsDir = getProjectRunsDir(PROJECT_ID);
      expect(await filesMentioning(runsDir, loserPlan)).toEqual([]);
      expect(await filesMentioning(runsDir, winnerPlan)).toHaveLength(1);
    });
  });

  it("a new run after a failed or stopped one succeeds and leaves the old run untouched", async () => {
    await withReadyModelRoles(async () => {
      for (const terminal of ["failed", "stopped"] as const) {
        const repos = createTestRepositories();
        const ticketId = `T-255-${terminal}`;

        const first = await dispatchHttp(createRunRequest(ticketId), repos);
        expect(first.status).toBe(201);
        const oldRun = (await first.json()) as { id: string };
        // Through the real state machine: `preparing` may fail or be stopped.
        repos.runs.transitionRun(oldRun.id, "preparing", terminal);
        const oldBefore = repos.runs.get(oldRun.id);
        const oldRunDir = path.join(getProjectRunsDir(PROJECT_ID), oldRun.id);
        const oldFilesBefore = await snapshotFiles(oldRunDir);

        const second = await dispatchHttp(
          createRunRequest(ticketId, { plan: "The new attempt's plan" }),
          repos,
        );
        expect(second.status).toBe(201);
        const newRun = (await second.json()) as { id: string };
        expect(newRun.id).not.toBe(oldRun.id);

        // Two runs for the ticket, the old one exactly as it was, files included.
        expect(
          repos.runs
            .list()
            .map((run) => run.id)
            .sort(),
        ).toEqual([oldRun.id, newRun.id].sort());
        expect(repos.runs.get(oldRun.id)).toEqual(oldBefore);
        expect(await snapshotFiles(oldRunDir)).toEqual(oldFilesBefore);
        expect(Object.keys(oldFilesBefore)).toHaveLength(2);
      }
    });
  });

  it("a creation whose files cannot be written removes the run it inserted", async () => {
    ensureProject(DEAD_DISK_PROJECT_ID, { repositoryPath: repoDir });
    await withReadyModelRoles(async () => {
      // A FILE where the project's runs directory must be: the insert can win,
      // but writing the run's artifacts cannot.
      const runsDir = getProjectRunsDir(DEAD_DISK_PROJECT_ID);
      await mkdir(path.dirname(runsDir), { recursive: true });
      await writeFile(runsDir, "not a directory\n");

      const repos = createTestRepositories();
      const res = await dispatchHttp(
        createRunRequest("T-255-dead-disk", {
          projectId: DEAD_DISK_PROJECT_ID,
        }),
        repos,
      );

      expect(res.status).toBe(500);
      // No half-created run is left behind for a worker to claim.
      expect(repos.runs.list()).toHaveLength(0);
      expect(countJobs(repos)).toBe(0);
    });
  });
});
