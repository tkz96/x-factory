// test/event-store.test.ts — Unit tests for durable event store, monotonic sequence, and SSE replay (XFM-12, XFM-13, XFM-15).

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { formatSSEMessage } from "../src/http/responses.js";

describe("Durable Event Store & SSE Replay (XFM-12, XFM-13, XFM-15)", () => {
  let db: Database;
  let runRepo: RunRepository;
  let eventRepo: EventRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    runRepo = new RunRepository(db);
    eventRepo = new EventRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function setupRun(id: string) {
    return runRepo.create({
      id,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T1", title: "Test", acceptanceCriteria: [] },
      plan: "plan",
      branch: "branch",
      status: "preparing",
      artifactsDir: `/tmp/runs/${id}`,
      worktreePath: `/tmp/wt/${id}`,
    });
  }

  it("allocates monotonic sequences per run starting at 1 (XFM-13)", () => {
    setupRun("run-seq-1");

    const e1 = eventRepo.appendEvent("run-seq-1", "status", {
      status: "preparing",
    });
    const e2 = eventRepo.appendEvent("run-seq-1", "stage_evidence", {
      stage: "parse",
      summary: "Done",
    });
    const e3 = eventRepo.appendEvent("run-seq-1", "info", {
      message: "Running",
    });

    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e3.sequence).toBe(3);
    expect(eventRepo.getLatestSequence("run-seq-1")).toBe(3);
  });

  it("maintains independent sequences across different runs without contention", () => {
    setupRun("run-alpha");
    setupRun("run-beta");

    const a1 = eventRepo.appendEvent("run-alpha", "info", "alpha 1");
    const b1 = eventRepo.appendEvent("run-beta", "info", "beta 1");
    const a2 = eventRepo.appendEvent("run-alpha", "info", "alpha 2");
    const b2 = eventRepo.appendEvent("run-beta", "info", "beta 2");

    expect(a1.sequence).toBe(1);
    expect(a2.sequence).toBe(2);
    expect(b1.sequence).toBe(1);
    expect(b2.sequence).toBe(2);
  });

  it("enforces database-level UNIQUE(run_id, sequence) constraint", () => {
    setupRun("run-unique");
    eventRepo.appendEvent("run-unique", "info", "evt 1");

    // Manually inserting duplicate (run_unique, 1) should be rejected by SQLite
    expect(() => {
      db.prepare(`
        INSERT INTO run_events (run_id, sequence, type, payload, created_at)
        VALUES ('run-unique', 1, 'duplicate', '{}', datetime('now'));
      `).run();
    }).toThrow();
  });

  it("filters events by sinceSequence for SSE replay (XFM-15)", () => {
    setupRun("run-replay");

    for (let i = 1; i <= 5; i++) {
      eventRepo.appendEvent("run-replay", "info", { count: i });
    }

    // Replay since sequence 3: should return sequences 4 and 5
    const replayed = eventRepo.getEventsForRun("run-replay", {
      sinceSequence: 3,
    });
    expect(replayed.length).toBe(2);
    expect(replayed[0]?.sequence).toBe(4);
    expect(replayed[1]?.sequence).toBe(5);

    // Replay from beginning (no sinceSequence)
    const allEvents = eventRepo.getEventsForRun("run-replay");
    expect(allEvents.length).toBe(5);
  });

  it("formats SSE messages with id: sequence and data framing (XFM-12, Section 34)", () => {
    const sseText = formatSSEMessage({
      sequence: 17,
      type: "stage_evidence",
      payload: { stage: "verify", passed: true },
    });

    expect(sseText).toContain("id: 17\n");
    expect(sseText).not.toContain("event: stage_evidence\n");
    expect(sseText).toContain('"id":17');
    expect(sseText).toContain('"type":"stage_evidence"');
    expect(sseText).toContain('"payload":{"stage":"verify","passed":true}');
    expect(sseText.endsWith("\n\n")).toBe(true);
  });
});
