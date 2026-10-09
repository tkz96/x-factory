// test/run-row-codec.test.ts — Regression tests for #179.
//
// Seam: HTTP API (handleApi with an in-memory SQLite connection from the
// composition root) plus the repository seam for tables without their own
// endpoint. A run row with one malformed JSON column still lists via
// GET /api/runs; only the malformed field degrades, and the codec logs a
// warning naming the table, column and row — at most once per row per
// process, and never echoing any part of the malformed value. Malformed
// columns in the other JSON-bearing tables (run_events, run_commands,
// stage_attempts, operation_ledger) degrade the same way, string values
// round-trip through serialization, and chatWithRun consumes the
// codec-parsed implementationContext without re-parsing it. Also guards,
// at typecheck time, that no repository method takes a transaction-DB
// parameter.

import { beforeEach, describe, it, spyOn } from "bun:test";
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

function seedRun(id = "run-1"): void {
  repos.runs.create({
    id,
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

interface WarningEntry {
  level: string;
  table: string;
  column: string;
  row_id: string;
}

function capturedWarnings(warnSpy: {
  mock: { calls: unknown[][] };
}): WarningEntry[] {
  return warnSpy.mock.calls
    .map((call) => String(call[0]))
    .map((line) => JSON.parse(line) as WarningEntry)
    .filter((entry) => entry.level === "warn")
    .map(({ level, table, column, row_id }) => ({
      level,
      table,
      column,
      row_id,
    }));
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

describe("a malformed JSON column in any table degrades only that field (#179)", () => {
  it("run_events.payload degrades to its raw text", () => {
    seedRun();
    repos.events.appendEvent("run-1", "info", { text: "hello" });
    repos.db.run(`UPDATE run_events SET payload = ? WHERE run_id = 'run-1';`, [
      "not-json[",
    ]);

    const events = repos.events.getEventsForRun("run-1");
    assert.equal(events.length, 1);
    const event = events[0];
    assert.ok(event);
    assert.equal(event.type, "info");
    assert.equal(event.payload as unknown, "not-json[");
  });

  it("run_commands.payload degrades to null", () => {
    seedRun();
    const cmd = repos.commands.insertOrRetryCommand({
      runId: "run-1",
      command: "deliver",
      idempotencyKey: "deliver:run-1",
      payload: { jobId: "job-1" },
    });
    repos.db.run(`UPDATE run_commands SET payload = ? WHERE id = ?;`, [
      '{"jobId":',
      cmd.id,
    ]);

    const fetched = repos.commands.getCommand(cmd.id);
    assert.ok(fetched);
    assert.equal(fetched.payload, null);
    // Only the payload is lost.
    assert.equal(fetched.command, "deliver");
    assert.equal(fetched.status, "pending");
  });

  it("stage_attempts.output degrades to its raw text", () => {
    seedRun();
    const attempt = repos.stageAttempts.recordStart("run-1", "prepare");
    repos.db.run(`UPDATE stage_attempts SET output = ? WHERE id = ?;`, [
      "[1,2",
      attempt.id,
    ]);

    const fetched = repos.stageAttempts.listForRun("run-1")[0];
    assert.ok(fetched);
    assert.equal(fetched.output, "[1,2");
    assert.equal(fetched.status, "running");
  });

  it("operation_ledger.result degrades to its raw text", () => {
    seedRun();
    repos.operationLedger.recordCompleted("run-1", "create_pr", "pr-1", {
      url: "https://example.com/pr/1",
    });
    repos.db.run(
      `UPDATE operation_ledger SET result = ? WHERE run_id = 'run-1';`,
      ['{"url":'],
    );

    const op = repos.operationLedger.listForRun("run-1")[0];
    assert.ok(op);
    assert.equal(op.result, '{"url":');
    assert.equal(op.externalId, "pr-1");
    assert.equal(op.status, "completed");
  });

  it("run_commands.result degrades to its raw text", () => {
    seedRun();
    const cmd = repos.commands.insertOrRetryCommand({
      runId: "run-1",
      command: "deliver",
      idempotencyKey: "deliver:run-1",
      payload: { jobId: "job-1" },
    });
    repos.db.run(`UPDATE run_commands SET result = ? WHERE id = ?;`, [
      '{"prUrl":',
      cmd.id,
    ]);

    const fetched = repos.commands.getCommand(cmd.id);
    assert.ok(fetched);
    assert.equal(fetched.result, '{"prUrl":');
    // Only the result is lost.
    assert.equal(fetched.command, "deliver");
    assert.equal(fetched.status, "pending");
  });
});

describe("a malformed column logs a warning naming table, column and row (#179)", () => {
  it("warns with the column identity when runs.verification fails to parse", async () => {
    seedRun("run-warn-1");
    repos.db.run(`UPDATE runs SET verification = ? WHERE id = 'run-warn-1';`, [
      "}{",
    ]);

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { status } = await listRuns();
      assert.equal(status, 200);
      assert.deepEqual(capturedWarnings(warnSpy), [
        {
          level: "warn",
          table: "runs",
          column: "verification",
          row_id: "run-warn-1",
        },
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never puts any part of the malformed value into the warning (#179)", async () => {
    seedRun("run-leak-1");
    const malformed = "sk-secret-abc123 xyz";
    repos.db.run(`UPDATE runs SET verification = ? WHERE id = 'run-leak-1';`, [
      malformed,
    ]);

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { status } = await listRuns();
      assert.equal(status, 200);

      // The full serialized warning, unmapped — the mapped helper above
      // discards exactly the field where the leak hides.
      const serialized = warnSpy.mock.calls
        .map((call) => call.map(String).join(" "))
        .join("\n");
      // Red first: a warning must exist so the leak check isn't vacuous.
      assert.ok(
        warnSpy.mock.calls.length > 0,
        "expected a malformed-column warning",
      );
      // The warning must not echo the column value or any token from it.
      // JSON parse errors quote raw content (Bun: `JSON Parse error:
      // Unexpected identifier "sk"`), and these columns hold run output that
      // can contain secrets.
      assert.ok(
        !serialized.includes(malformed),
        `warning leaked the malformed text: ${serialized}`,
      );
      for (const token of ["sk", "secret", "abc123", "xyz"]) {
        assert.ok(
          !serialized.includes(token),
          `warning leaked token "${token}": ${serialized}`,
        );
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns with the column identity when run_commands.result fails to parse", () => {
    seedRun();
    const cmd = repos.commands.insertOrRetryCommand({
      runId: "run-1",
      command: "deliver",
      idempotencyKey: "deliver:run-1",
      payload: { jobId: "job-1" },
    });
    repos.db.run(`UPDATE run_commands SET result = ? WHERE id = ?;`, [
      '{"prUrl":',
      cmd.id,
    ]);

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      assert.ok(repos.commands.getCommand(cmd.id));
      assert.deepEqual(capturedWarnings(warnSpy), [
        {
          level: "warn",
          table: "run_commands",
          column: "result",
          row_id: cmd.id,
        },
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("logs no warning when every column is well-formed", async () => {
    seedRun();

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { status } = await listRuns();
      assert.equal(status, 200);
      assert.equal(warnSpy.mock.calls.length, 0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("a malformed column warns at most once per process (#179)", () => {
  it("warns once for a row, not again on the next read, but still for another row", async () => {
    seedRun("run-dedupe-1");
    repos.db.run(
      `UPDATE runs SET verification = ? WHERE id = 'run-dedupe-1';`,
      ["}{"],
    );

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await listRuns();
      assert.equal(warnSpy.mock.calls.length, 1);

      // A second read of the same corrupt row must not warn again...
      await listRuns();
      assert.equal(warnSpy.mock.calls.length, 1);

      // ...but a different corrupt row is a new (table, column, row id) key.
      seedRun("run-dedupe-2");
      repos.db.run(
        `UPDATE runs SET verification = ? WHERE id = 'run-dedupe-2';`,
        ["}{"],
      );
      await listRuns();
      const entries = capturedWarnings(warnSpy);
      assert.equal(entries.length, 2);
      assert.equal(entries[1]?.row_id, "run-dedupe-2");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns once for a legacy plain-text stage output on every read", () => {
    seedRun();
    const attempt = repos.stageAttempts.recordStart("run-1", "prepare");
    // A row written before the codec always JSON-encoded writes: plain text
    // like "Build ok" fails to parse on EVERY read of that row.
    repos.db.run(`UPDATE stage_attempts SET output = ? WHERE id = ?;`, [
      "Build ok",
      attempt.id,
    ]);

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = repos.stageAttempts.listForRun("run-1");
      assert.equal(first[0]?.output, "Build ok");
      assert.equal(warnSpy.mock.calls.length, 1);

      const second = repos.stageAttempts.listForRun("run-1");
      assert.equal(second[0]?.output, "Build ok");
      assert.equal(warnSpy.mock.calls.length, 1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("string values round-trip through the codec (#179)", () => {
  it("a stage-attempt output that looks like JSON comes back as the same string", () => {
    seedRun();
    const attempt = repos.stageAttempts.recordStart("run-1", "prepare");
    repos.stageAttempts.recordCompletion(attempt.id, '{"looks":"like json"}');

    const fetched = repos.stageAttempts.listForRun("run-1")[0];
    assert.ok(fetched);
    assert.equal(fetched.output, '{"looks":"like json"}');
  });

  it("an operation-ledger result that looks like JSON comes back as the same string", () => {
    seedRun();
    repos.operationLedger.recordCompleted(
      "run-1",
      "create_pr",
      "pr-1",
      '{"url":"https://example.com/pr/1"}',
    );

    const op = repos.operationLedger.listForRun("run-1")[0];
    assert.ok(op);
    assert.equal(op.result, '{"url":"https://example.com/pr/1"}');
  });
});

describe("chatWithRun consumes the codec-parsed implementationContext (#179)", () => {
  it("answers a chat on an approval gate without re-parsing the context", async () => {
    seedRun();
    repos.runs.update("run-1", { status: "awaiting_plan_approval" });
    repos.runs.update("run-1", {
      implementationContext: {
        relevantFiles: ["src/runs.ts"],
        architecturalNotes: "One row codec",
        existingBehavior: "JSON.parse inline",
        constraints: ["SQLite only"],
        risks: ["silent degradation"],
      },
    });

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const req = new Request("http://localhost:3777/api/runs/run-1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What are the risks?" }),
      });
      const res = await handleApi(req, new URL(req.url), { repos });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; message: string };
      assert.equal(body.ok, true);

      const events = repos.events.getEventsForRun("run-1");
      const userEvt = events.find((e) => e.type === "chat_user");
      assert.deepEqual(userEvt?.payload, { text: "What are the risks?" });
      const agentEvt = events.find((e) => e.type === "chat_agent");
      assert.ok(agentEvt);
      assert.equal(
        typeof (agentEvt.payload as { text?: unknown }).text,
        "string",
      );
    } finally {
      errSpy.mockRestore();
    }
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
