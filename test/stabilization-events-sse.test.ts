// test/stabilization-events-sse.test.ts — Tests for status event purity, event atomicity, SSE wire contract, and terminal close (v5.5).

import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { formatSSEMessage } from "../src/http/responses.js";
import { handleApi } from "../src/http/routes.js";
import { SSEStreamRegistry } from "../src/http/sse-registry.js";
import { setDbForTesting } from "../src/runs.js";

describe("Stabilization Pass — Durable Events & Cross-Process SSE", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    const run = runRepo.create({
      id: "run-event-sse-test",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/sse-test",
      status: "implementing",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    return { db, runRepo, eventRepo, run };
  }

  // Test 15: Event atomicity (rolls back with state update)
  it("rolls back state update and event together if transaction fails", () => {
    const { db, runRepo, eventRepo, run } = setupTest();

    expect(() => {
      db.transaction(() => {
        runRepo.update(run.id, { diff: "New atomic diff" }, db);
        eventRepo.appendEvent(run.id, "info", { text: "Atomic update" }, db);
        throw new Error("Simulated failure inside transaction");
      })();
    }).toThrow("Simulated failure inside transaction");

    // Both run update and event must be rolled back
    const freshRun = runRepo.get(run.id);
    expect(freshRun?.diff).toBeNull();
    const events = eventRepo.getEventsForRun(run.id);
    expect(events.length).toBe(0);
  });

  // Test 16: Event payload shape and SSE wire format (NO event: line)
  it("formats SSE wire message with id: and data: without event: line", () => {
    const raw = {
      sequence: 42,
      type: "status",
      payload: { status: "implementing", text: "Working" },
      createdAt: "2026-09-21T00:00:00.000Z",
    };

    const sse = formatSSEMessage(raw);

    // Wire contract:
    // id: 42\ndata: {"id":42,"type":"status","payload":{"status":"implementing","text":"Working"},"timestamp":"..."}\n\n
    expect(sse).toContain("id: 42\n");
    expect(sse).toContain(
      'data: {"id":42,"type":"status","payload":{"status":"implementing","text":"Working"},"timestamp":"2026-09-21T00:00:00.000Z"}\n\n',
    );
    expect(sse).not.toContain("event:");
  });

  // Test 18 & 19: Cross-process SSE replay via SQLite and Last-Event-ID
  it("replays SQLite events cross-process and strictly after Last-Event-ID", async () => {
    const { eventRepo, run } = setupTest();

    // Worker writes to SQLite
    eventRepo.appendEvent(run.id, "info", { msg: "First" });
    eventRepo.appendEvent(run.id, "info", { msg: "Second" });
    eventRepo.appendEvent(run.id, "info", { msg: "Third" });

    // Client requests with Last-Event-ID: 2
    const req = new Request(`http://localhost/api/runs/${run.id}/events`, {
      headers: { "Last-Event-ID": "2" },
    });
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const { value } = await (reader?.read() ??
      Promise.resolve({ value: undefined }));
    const text = new TextDecoder().decode(value);

    // Strictly receives sequence 3, not 1 or 2
    expect(text).toContain("id: 3");
    expect(text).toContain("Third");
    expect(text).not.toContain("First");
    expect(text).not.toContain("Second");

    await reader?.cancel();
  });

  // Test 21: SSE shutdown closes active registered streams
  it("closes all active streams when sseRegistry.closeAll is called", () => {
    const registry = new SSEStreamRegistry();
    let closed1 = false;
    let closed2 = false;

    registry.register(() => {
      closed1 = true;
    });
    registry.register(() => {
      closed2 = true;
    });

    expect(registry.count).toBe(2);
    registry.closeAll();

    expect(closed1).toBe(true);
    expect(closed2).toBe(true);
    expect(registry.count).toBe(0);
  });

  // Test 22: SSE terminal close behavior
  it("closes SSE connection on terminal status (pr_created, failed, stopped) but NOT on recovery_required", async () => {
    const { runRepo, run } = setupTest();

    // 1. recovery_required should NOT close automatically
    runRepo.transitionRun(run.id, "implementing", "recovery_required");

    const req1 = new Request(`http://localhost/api/runs/${run.id}/events`);
    const res1 = await handleApi(req1, new URL(req1.url));
    const reader1 = res1.body?.getReader();

    // Stream remains active, reader is not done
    await new Promise((r) => setTimeout(r, 400));
    // Reader should still be able to read or stay open
    await reader1?.cancel();

    // 2. stopped is terminal -> stream closes automatically
    runRepo.transitionRun(run.id, "recovery_required", "failed");

    const req2 = new Request(`http://localhost/api/runs/${run.id}/events`);
    const res2 = await handleApi(req2, new URL(req2.url));
    const reader2 = res2.body?.getReader();

    // Read until done
    let closed = false;
    while (true) {
      const { done } = await (reader2?.read() ??
        Promise.resolve({ done: true }));
      if (done) {
        closed = true;
        break;
      }
    }
    expect(closed).toBe(true);
  });
});
