// test/run-row-codec.test.ts — Regression tests for #179.
//
// Seam: HTTP API (handleApi with an in-memory SQLite connection from the
// composition root). A run row with one malformed JSON column still lists via
// GET /api/runs; only the malformed field degrades. Also guards, at typecheck
// time, that no repository method takes a transaction-DB parameter.

import { beforeEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { Repositories } from "../src/composition-root.js";
import { handleApi } from "../src/http/routes.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

/** The run fields these tests assert on, as they arrive over the wire. */
interface ListedRunBody {
  id: string;
  status: string;
  plan: string;
  revision: number;
  ticket: { acceptanceCriteria: unknown };
  implementationContext: unknown;
  verification: unknown;
  review: unknown;
  artifacts: unknown;
  pullRequest: unknown;
}

beforeEach(() => {
  repos = createTestRepositories();
});

function seedRun(): void {
  repos.runs.create({
    id: "run-1",
    projectId: "proj-1",
    projectName: "Proj 1",
    ticket: {
      id: "T-1",
      title: "Ticket one",
      description: "Description",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
    },
    plan: "Do the thing",
    branch: "factory/t-1",
    status: "executing",
    artifactsDir: "/tmp/a-run-1",
    worktreePath: "/tmp/w-run-1",
  });
}

async function listRuns(): Promise<{ status: number; body: ListedRunBody[] }> {
  const req = new Request("http://localhost:3777/api/runs", {
    method: "GET",
  });
  const res = await handleApi(req, new URL(req.url), { repos });
  return { status: res.status, body: await res.json() };
}

describe("a malformed run JSON column degrades only that field (#179)", () => {
  const cases: Array<{
    column: string;
    malformed: string;
    pick: (run: ListedRunBody) => unknown;
    expected: unknown;
  }> = [
    {
      column: "ticket_acceptance_criteria",
      malformed: "not-json[",
      pick: (run) => run.ticket.acceptanceCriteria,
      expected: [],
    },
    {
      column: "implementation_context",
      malformed: '{"relevantFiles":',
      pick: (run) => run.implementationContext,
      expected: null,
    },
    {
      column: "verification",
      malformed: "}{",
      pick: (run) => run.verification,
      expected: null,
    },
    {
      column: "review",
      malformed: '{"passed":true',
      pick: (run) => run.review,
      expected: null,
    },
    {
      column: "artifacts",
      malformed: "[1,2",
      pick: (run) => run.artifacts,
      expected: [],
    },
    {
      column: "pull_request",
      malformed: '{"url":',
      pick: (run) => run.pullRequest,
      expected: null,
    },
  ];

  for (const { column, malformed, pick, expected } of cases) {
    it(`lists the run when ${column} is "${malformed}", degrading that field`, async () => {
      seedRun();
      repos.db.run(`UPDATE runs SET ${column} = ? WHERE id = 'run-1';`, [
        malformed,
      ]);

      const { status, body } = await listRuns();
      assert.equal(status, 200);
      assert.equal(body.length, 1);
      const run = body[0];
      assert.ok(run);
      assert.equal(run.id, "run-1");
      assert.equal(run.status, "executing");
      assert.equal(run.plan, "Do the thing");
      assert.equal(run.revision, 1);
      assert.deepEqual(pick(run), expected);
    });
  }

  it("parses well-formed columns through the same path", async () => {
    seedRun();
    repos.db.run(`UPDATE runs SET review = ? WHERE id = 'run-1';`, [
      '{"passed":true,"summary":"looks good","issues":[]}',
    ]);

    const { status, body } = await listRuns();
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    const run = body[0];
    assert.ok(run);
    assert.deepEqual(run.review, {
      passed: true,
      summary: "looks good",
      issues: [],
    });
    assert.deepEqual(run.ticket, {
      id: "T-1",
      title: "Ticket one",
      description: "Description",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
    });
  });
});

describe("no repository method takes a transaction-DB parameter (#179)", () => {
  it("rejects a trailing Database argument at typecheck time", () => {
    const { runs, jobs, events, commands, stageAttempts, heartbeats, db } =
      createTestRepositories();

    // Each call would accept a transaction DB if one were still a parameter.
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.equal(runs.get("run-1", db), null);
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.equal(jobs.getJob("job-1", db), null);
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.deepEqual(events.getEventsForRun("run-1", undefined, db), []);
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.equal(commands.getCommand("cmd-1", db), null);
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.deepEqual(stageAttempts.listForRun("run-1", db), []);
    // @ts-expect-error — no repository method takes a transaction-DB parameter (#179).
    assert.deepEqual(heartbeats.getActiveWorkers(30000, db), []);
  });
});
