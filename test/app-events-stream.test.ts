// test/app-events-stream.test.ts — App-wide event stream and snapshot tests (#257, spec #241).

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createRepositories } from "../src/composition-root.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { appEventHubFor } from "../src/http/app-event-hub.js";
import { handleApi } from "../src/http/routes.js";
import { defaultSSERegistry } from "../src/http/sse-registry.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  RunStatus,
} from "../src/shared/types.js";

function setupTestDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const repos = createRepositories(db);
  const runRepo = new RunRepository(db);
  const eventRepo = new EventRepository(db);

  function createTestRun(
    id: string,
    status: RunStatus = "executing",
    overrides?: {
      projectId?: string;
      projectName?: string;
      ticketId?: string;
      ticketTitle?: string;
    },
  ) {
    return runRepo.create({
      id,
      projectId: overrides?.projectId ?? "proj-1",
      projectName: overrides?.projectName ?? "Project 1",
      ticket: {
        id: overrides?.ticketId ?? "T-1",
        title: overrides?.ticketTitle ?? "Ticket 1",
        acceptanceCriteria: ["Criterion 1"],
      },
      plan: "Test Plan",
      branch: `feat/${id}`,
      status,
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });
  }

  function transitionRun(runId: string, from: RunStatus, to: RunStatus) {
    return runRepo.transitionRun(runId, from, to, {
      event: {
        type: "status",
        payload: {
          status: to,
          text: `Status changed to ${to}`,
        },
      },
    });
  }

  return { db, repos, runRepo, eventRepo, createTestRun, transitionRun };
}

async function readSseText(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  minEvents = 1,
  timeoutMs = 1000,
): Promise<string> {
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const readPromise = reader.read();
    const timeoutPromise = new Promise<{ value: undefined; done: true }>(
      (resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), 200),
    );
    const { value, done } = await Promise.race([readPromise, timeoutPromise]);
    if (value) {
      text += decoder.decode(value);
    }
    const idMatches = text.match(/id: \d+\n/g);
    if (idMatches && idMatches.length >= minEvents) {
      break;
    }
    if (done) break;
  }
  return text;
}

describe("App-wide event stream and consistent snapshot (#257)", () => {
  it("distinct global IDs across runs with equal per-run sequences, with own envelope", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-a", "executing");
    createTestRun("run-b", "executing");

    // Both runs append their first status event (sequence 1 for each)
    const eventA = eventRepo.appendEvent("run-a", "status", {
      status: "executing",
      text: "Run A executing",
    });
    const eventB = eventRepo.appendEvent("run-b", "status", {
      status: "executing",
      text: "Run B executing",
    });

    expect(eventA.sequence).toBe(1);
    expect(eventB.sequence).toBe(1);
    expect(eventA.id).not.toBe(eventB.id);

    // Request app-wide stream from cursor 0
    const req = new Request("http://localhost:3777/api/events?last_event_id=0");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const text = await readSseText(reader, 2);
    await reader?.cancel();

    // Check envelope format: SSE id matches global run-events id
    expect(text).toContain(`id: ${eventA.id}\n`);
    expect(text).toContain(`id: ${eventB.id}\n`);

    // Parse the data frames
    const lines = text.split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    expect(dataLines.length).toBeGreaterThanOrEqual(2);

    const line0 = dataLines[0];
    const line1 = dataLines[1];
    if (!line0 || !line1) throw new Error("Missing expected SSE data lines");
    const envelopeA = JSON.parse(
      line0.replace("data: ", ""),
    ) as AppEventEnvelope;
    const envelopeB = JSON.parse(
      line1.replace("data: ", ""),
    ) as AppEventEnvelope;

    expect(envelopeA.id).toBe(eventA.id);
    expect(envelopeA.runId).toBe("run-a");
    expect(envelopeA.sequence).toBe(1);
    expect(envelopeA.type).toBe("status");
    expect(envelopeA.ticket.id).toBe("T-1");
    expect(envelopeA.project.id).toBe("proj-1");
    expect(envelopeA.time).toBeDefined();

    expect(envelopeB.id).toBe(eventB.id);
    expect(envelopeB.runId).toBe("run-b");
    expect(envelopeB.sequence).toBe(1);
    expect(envelopeB.type).toBe("status");
  });

  it("resumes via query cursor and via Last-Event-ID header", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-1", "executing");
    const e1 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "1",
    });
    const e2 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "2",
    });
    const e3 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "3",
    });

    // 1. Resume via query cursor: ?last_event_id=e1.id
    const reqQuery = new Request(
      `http://localhost:3777/api/events?last_event_id=${e1.id}`,
    );
    const resQuery = await handleApi(reqQuery, new URL(reqQuery.url), {
      repos,
    });
    expect(resQuery.status).toBe(200);

    const readerQuery = resQuery.body?.getReader();
    const textQuery = await readSseText(readerQuery, 2);
    await readerQuery?.cancel();

    expect(textQuery).not.toContain(`id: ${e1.id}\n`);
    expect(textQuery).toContain(`id: ${e2.id}\n`);
    expect(textQuery).toContain(`id: ${e3.id}\n`);

    // 2. Resume via Last-Event-ID header
    const reqHeader = new Request("http://localhost:3777/api/events", {
      headers: { "Last-Event-ID": String(e2.id) },
    });
    const resHeader = await handleApi(reqHeader, new URL(reqHeader.url), {
      repos,
    });
    expect(resHeader.status).toBe(200);

    const readerHeader = resHeader.body?.getReader();
    const textHeader = await readSseText(readerHeader, 1);
    await readerHeader?.cancel();

    expect(textHeader).not.toContain(`id: ${e1.id}\n`);
    expect(textHeader).not.toContain(`id: ${e2.id}\n`);
    expect(textHeader).toContain(`id: ${e3.id}\n`);
  });

  it("lower cursor wins when both query cursor and Last-Event-ID are present", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-1", "executing");
    const e1 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "1",
    });
    const e2 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "2",
    });
    const e3 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "3",
    });

    // Query = e2.id (higher), Header = e1.id (lower) -> lower wins (e1.id)
    const req1 = new Request(
      `http://localhost:3777/api/events?last_event_id=${e2.id}`,
      {
        headers: { "Last-Event-ID": String(e1.id) },
      },
    );
    const res1 = await handleApi(req1, new URL(req1.url), { repos });
    expect(res1.status).toBe(200);

    const reader1 = res1.body?.getReader();
    const text1 = await readSseText(reader1, 2);
    await reader1?.cancel();

    expect(text1).not.toContain(`id: ${e1.id}\n`);
    expect(text1).toContain(`id: ${e2.id}\n`);
    expect(text1).toContain(`id: ${e3.id}\n`);

    // Query = e1.id (lower), Header = e2.id (higher) -> lower wins (e1.id)
    const req2 = new Request(
      `http://localhost:3777/api/events?last_event_id=${e1.id}`,
      {
        headers: { "Last-Event-ID": String(e2.id) },
      },
    );
    const res2 = await handleApi(req2, new URL(req2.url), { repos });
    expect(res2.status).toBe(200);

    const reader2 = res2.body?.getReader();
    const text2 = await readSseText(reader2, 2);
    await reader2?.cancel();

    expect(text2).not.toContain(`id: ${e1.id}\n`);
    expect(text2).toContain(`id: ${e2.id}\n`);
    expect(text2).toContain(`id: ${e3.id}\n`);
  });

  it("handles malformed and negative query cursors: invalid counts as absent; no valid cursor rejects", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-1", "executing");
    const e1 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "1",
    });
    const e2 = eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "2",
    });

    // Negative query cursor with valid Last-Event-ID -> query is absent, resumes from Last-Event-ID
    const reqNeg = new Request(
      "http://localhost:3777/api/events?last_event_id=-1",
      {
        headers: { "Last-Event-ID": String(e1.id) },
      },
    );
    const resNeg = await handleApi(reqNeg, new URL(reqNeg.url), { repos });
    expect(resNeg.status).toBe(200);

    const readerNeg = resNeg.body?.getReader();
    const textNeg = await readSseText(readerNeg, 1);
    await readerNeg?.cancel();

    expect(textNeg).not.toContain(`id: ${e1.id}\n`);
    expect(textNeg).toContain(`id: ${e2.id}\n`);

    // Malformed query cursor with valid Last-Event-ID -> query is absent, resumes from Last-Event-ID
    const reqMalformed = new Request(
      "http://localhost:3777/api/events?last_event_id=abc",
      {
        headers: { "Last-Event-ID": String(e1.id) },
      },
    );
    const resMalformed = await handleApi(
      reqMalformed,
      new URL(reqMalformed.url),
      { repos },
    );
    expect(resMalformed.status).toBe(200);
    await resMalformed.body?.cancel();

    // No valid cursor at all (no query, no header) -> 400 Bad Request telling client to snapshot
    const reqNone = new Request("http://localhost:3777/api/events");
    const resNone = await handleApi(reqNone, new URL(reqNone.url), { repos });
    expect(resNone.status).toBe(400);
    const jsonNone = (await resNone.json()) as { error: string };
    expect(jsonNone.error.toLowerCase()).toContain("snapshot");

    // Invalid cursor alone -> 400 Bad Request telling client to snapshot
    const reqInvalidOnly = new Request(
      "http://localhost:3777/api/events?last_event_id=bad",
    );
    const resInvalidOnly = await handleApi(
      reqInvalidOnly,
      new URL(reqInvalidOnly.url),
      { repos },
    );
    expect(resInvalidOnly.status).toBe(400);
    const jsonInvalid = (await resInvalidOnly.json()) as { error: string };
    expect(jsonInvalid.error.toLowerCase()).toContain("snapshot");

    // Negative cursor alone -> 400 Bad Request telling client to snapshot
    const reqNegOnly = new Request(
      "http://localhost:3777/api/events?last_event_id=-5",
    );
    const resNegOnly = await handleApi(reqNegOnly, new URL(reqNegOnly.url), {
      repos,
    });
    expect(resNegOnly.status).toBe(400);
    const jsonNeg = (await resNegOnly.json()) as { error: string };
    expect(jsonNeg.error.toLowerCase()).toContain("snapshot");
  });

  it("no-gap between snapshot and subscription", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-1", "executing");
    eventRepo.appendEvent("run-1", "status", {
      status: "executing",
      text: "initial",
    });

    // 1. Client takes snapshot
    const reqSnap = new Request("http://localhost:3777/api/events/snapshot");
    const resSnap = await handleApi(reqSnap, new URL(reqSnap.url), { repos });
    expect(resSnap.status).toBe(200);
    const snapshot = (await resSnap.json()) as EventsSnapshot;
    expect(snapshot.cursor).toBeGreaterThan(0);

    // 2. Worker emits a new event in between
    const newEvent = eventRepo.appendEvent("run-1", "status", {
      status: "awaiting_review",
      text: "ready for review",
    });
    expect(newEvent.id).toBeGreaterThan(snapshot.cursor);

    // 3. Client subscribes starting exactly from the snapshot's cursor
    const reqStream = new Request(
      `http://localhost:3777/api/events?last_event_id=${snapshot.cursor}`,
    );
    const resStream = await handleApi(reqStream, new URL(reqStream.url), {
      repos,
    });
    expect(resStream.status).toBe(200);

    const reader = resStream.body?.getReader();
    const text = await readSseText(reader, 1);
    await reader?.cancel();

    // The intermediate event must be delivered: no gap!
    expect(text).toContain(`id: ${newEvent.id}\n`);
    expect(text).toContain("awaiting_review");
  });

  it("snapshot consistency under retention rules: Needs-you without age limit, Finished history window", async () => {
    const { db, repos, eventRepo, createTestRun, transitionRun } =
      setupTestDb();

    // 1. Run in Needs-you status created 10 days ago (older than 7 days)
    createTestRun("run-old-needs-you", "planning");
    // Transition planning -> awaiting_plan_approval (legal FSM transition)
    transitionRun("run-old-needs-you", "planning", "awaiting_plan_approval");
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(
      tenDaysAgo,
      "run-old-needs-you",
    );
    db.prepare("UPDATE run_events SET created_at = ? WHERE run_id = ?").run(
      tenDaysAgo,
      "run-old-needs-you",
    );

    // Get the triggering event ID
    const oldTriggerEvent = eventRepo.getEventsForRun("run-old-needs-you")[0];

    // 2. An old finished run (8 days ago) -> should NOT appear in Finished history
    createTestRun("run-old-finished", "executing");
    transitionRun("run-old-finished", "executing", "stopped");
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare("UPDATE run_events SET created_at = ? WHERE run_id = ?").run(
      eightDaysAgo,
      "run-old-finished",
    );

    // 3. Recent finished runs (within 7 days)
    createTestRun("run-recent-finished", "ready_for_pr");
    transitionRun("run-recent-finished", "ready_for_pr", "pr_created");

    // Fetch snapshot
    const reqSnap = new Request("http://localhost:3777/api/events/snapshot");
    const resSnap = await handleApi(reqSnap, new URL(reqSnap.url), { repos });
    expect(resSnap.status).toBe(200);
    const snapshot = (await resSnap.json()) as EventsSnapshot;

    // Check Needs-you retention: no age limit!
    const needsYouItem = snapshot.needsYou.find(
      (e) => e.runId === "run-old-needs-you",
    );
    expect(needsYouItem).toBeDefined();
    if (!oldTriggerEvent) throw new Error("Missing oldTriggerEvent");
    expect(needsYouItem?.id).toBe(oldTriggerEvent.id);
    expect(needsYouItem?.type).toBe("status");

    // Check Finished history retention:
    // Old finished run outside 7-day window is deliberately omitted
    const oldFinishedItem = snapshot.finished.find(
      (e) => e.runId === "run-old-finished",
    );
    expect(oldFinishedItem).toBeUndefined();

    // Recent finished run inside 7-day window appears
    const recentFinishedItem = snapshot.finished.find(
      (e) => e.runId === "run-recent-finished",
    );
    expect(recentFinishedItem).toBeDefined();
  });

  it("long-lived Needs-you run older than 7 days with >100 finished events still appears in snapshot", async () => {
    const { db, repos, eventRepo, createTestRun, transitionRun } =
      setupTestDb();

    // Long-lived Needs-you run
    createTestRun("run-long-needs-you", "understanding");
    transitionRun(
      "run-long-needs-you",
      "understanding",
      "awaiting_understanding_approval",
    );
    const twentyDaysAgo = new Date(
      Date.now() - 20 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(
      twentyDaysAgo,
      "run-long-needs-you",
    );
    db.prepare("UPDATE run_events SET created_at = ? WHERE run_id = ?").run(
      twentyDaysAgo,
      "run-long-needs-you",
    );

    const triggerEvent = eventRepo.getEventsForRun("run-long-needs-you")[0];

    // Create 105 finished events on other runs within the last 7 days
    for (let i = 0; i < 105; i++) {
      const r = createTestRun(`run-fin-${i}`, "executing");
      transitionRun(r.id, "executing", "stopped");
    }

    // Take snapshot
    const reqSnap = new Request("http://localhost:3777/api/events/snapshot");
    const resSnap = await handleApi(reqSnap, new URL(reqSnap.url), { repos });
    expect(resSnap.status).toBe(200);
    const snapshot = (await resSnap.json()) as EventsSnapshot;

    // Finished history is capped at 100 events
    expect(snapshot.finished.length).toBe(100);

    // Long-lived Needs-you run STILL appears, with its original triggering event ID!
    const item = snapshot.needsYou.find(
      (e) => e.runId === "run-long-needs-you",
    );
    expect(item).toBeDefined();
    if (!triggerEvent) throw new Error("Missing triggerEvent");
    expect(item?.id).toBe(triggerEvent.id);
  });

  it("replays delivered-but-unprocessed event and client deduplicates", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();

    createTestRun("run-replay", "executing");
    const e1 = eventRepo.appendEvent("run-replay", "status", {
      status: "executing",
      text: "e1",
    });
    const e2 = eventRepo.appendEvent("run-replay", "status", {
      status: "executing",
      text: "e2",
    });

    // Client connects from 0, receives e1 and e2.
    // Client processes e1 (moves client processed cursor to e1.id).
    // e2 is delivered, but client fails before applying it and moves no cursor.
    // Connection drops.
    // Client reconnects with its processed cursor e1.id.
    const reqReconnect = new Request(
      `http://localhost:3777/api/events?last_event_id=${e1.id}`,
    );
    const resReconnect = await handleApi(
      reqReconnect,
      new URL(reqReconnect.url),
      { repos },
    );
    expect(resReconnect.status).toBe(200);

    const reader = resReconnect.body?.getReader();
    const text = await readSseText(reader, 1);
    await reader?.cancel();

    // e2 is replayed with the exact same ID!
    expect(text).toContain(`id: ${e2.id}\n`);
    expect(text).not.toContain(`id: ${e1.id}\n`);
  });

  it("does not accept an undocumented cursor query alias", async () => {
    const { repos } = setupTestDb();
    const req = new Request("http://localhost:3777/api/events?cursor=0");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(400);
  });

  it("serves connections from one shared poller and stops it with the last one", async () => {
    const { repos, createTestRun } = setupTestDb();
    createTestRun("run-1", "executing");
    const hub = appEventHubFor(repos);

    const open = async () => {
      const req = new Request(
        "http://localhost:3777/api/events?last_event_id=0",
      );
      const res = await handleApi(req, new URL(req.url), { repos });
      return res.body?.getReader();
    };
    const a = await open();
    const b = await open();
    expect(hub.subscriberCount).toBe(2);
    expect(hub.isPolling).toBe(true);

    await a?.cancel();
    expect(hub.isPolling).toBe(true);
    await b?.cancel();
    expect(hub.subscriberCount).toBe(0);
    expect(hub.isPolling).toBe(false);
  });

  it("replays every event above a stale cursor in order across pages", async () => {
    const { repos, eventRepo, createTestRun } = setupTestDb();
    createTestRun("run-1", "executing");
    const total = 1203;
    for (let i = 0; i < total; i++) {
      eventRepo.appendEvent("run-1", "status", {
        status: "executing",
        text: String(i),
      });
    }
    const req = new Request("http://localhost:3777/api/events?last_event_id=0");
    const res = await handleApi(req, new URL(req.url), { repos });
    const reader = res.body?.getReader();
    const text = await readSseText(reader, total, 5000);
    await reader?.cancel();

    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBe(total);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(total);
  });

  it("handles SSE stream registry closeAll and reader cancel gracefully", async () => {
    const { repos } = setupTestDb();

    const req = new Request("http://localhost:3777/api/events?last_event_id=0");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);

    // Closing all connections in the SSE registry cancels the active stream
    defaultSSERegistry.closeAll();

    // The opening comment is written before the close, so it is read first.
    const reader = res.body?.getReader();
    const opening = await reader?.read();
    expect(new TextDecoder().decode(opening?.value)).toBe(": connected\n\n");
    const result = await reader?.read();
    expect(result?.done).toBe(true);
  });
});
