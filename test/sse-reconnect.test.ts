// test/sse-reconnect.test.ts — Gapless SSE replay across disconnects with Last-Event-ID (XFM-61).

import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { defaultEventBus } from "../src/events.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

describe("SSE Gapless Reconnect Replay (XFM-61)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    const runId = `run-sse-${Date.now()}`;
    const run = runRepo.create({
      id: runId,
      projectId: "proj-sse",
      projectName: "SSE Test Project",
      ticket: { id: "SSE-1", title: "SSE Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/sse-1",
      status: "implementing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    return { db, runRepo, eventRepo, runId, run };
  }

  async function readEvents(
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined | null,
    count: number,
  ): Promise<string[]> {
    if (!reader) throw new Error("reader is required");
    const events: string[] = [];
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      events.push(new TextDecoder().decode(value));
    }
    return events;
  }

  it("replays only missing events after Last-Event-ID on reconnection", async () => {
    const { eventRepo, runId } = setupTest();

    // 1. Emit events 1, 2, 3 into SQLite
    eventRepo.appendEvent(runId, "status", { step: 1, message: "Event 1" });
    eventRepo.appendEvent(runId, "status", { step: 2, message: "Event 2" });
    eventRepo.appendEvent(runId, "status", { step: 3, message: "Event 3" });

    // 2. Client #1 connects from beginning
    const req1 = new Request(`http://localhost/api/runs/${runId}/events`);
    const res1 = await handleApi(req1, new URL(req1.url));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("Content-Type")).toContain("text/event-stream");

    const reader1 = res1.body?.getReader();
    expect(reader1).toBeDefined();

    const events1 = await readEvents(reader1, 3);
    expect(events1.length).toBe(3);
    expect(events1[0]).toContain("id: 1");
    expect(events1[0]).toContain("Event 1");
    expect(events1[1]).toContain("id: 2");
    expect(events1[1]).toContain("Event 2");
    expect(events1[2]).toContain("id: 3");
    expect(events1[2]).toContain("Event 3");

    // 3. Client #1 disconnects
    await reader1?.cancel();

    // 4. Server emits events 4, 5, 6 while client is offline
    eventRepo.appendEvent(runId, "status", { step: 4, message: "Event 4" });
    eventRepo.appendEvent(runId, "status", { step: 5, message: "Event 5" });
    eventRepo.appendEvent(runId, "status", { step: 6, message: "Event 6" });

    // 5. Client reconnects with Last-Event-ID: 3 header
    const req2 = new Request(`http://localhost/api/runs/${runId}/events`, {
      headers: { "Last-Event-ID": "3" },
    });
    const res2 = await handleApi(req2, new URL(req2.url));
    expect(res2.status).toBe(200);

    const reader2 = res2.body?.getReader();
    expect(reader2).toBeDefined();

    // Must receive events 4, 5, 6
    const events2 = await readEvents(reader2, 3);
    expect(events2.length).toBe(3);

    // Verify none of the replayed chunks contain events 1, 2, 3
    const allReplayedText = events2.join("\n");
    expect(allReplayedText).not.toContain("Event 1");
    expect(allReplayedText).not.toContain("Event 2");
    expect(allReplayedText).not.toContain("Event 3");
    expect(allReplayedText).not.toContain("id: 1\n");
    expect(allReplayedText).not.toContain("id: 2\n");
    expect(allReplayedText).not.toContain("id: 3\n");

    // MUST contain events 4, 5, 6 in gapless sequence
    expect(events2[0]).toContain("id: 4");
    expect(events2[0]).toContain("Event 4");
    expect(events2[1]).toContain("id: 5");
    expect(events2[1]).toContain("Event 5");
    expect(events2[2]).toContain("id: 6");
    expect(events2[2]).toContain("Event 6");

    // 6. While connected, a live event 7 is emitted
    const livePromise = readEvents(reader2, 1);
    defaultEventBus.emit(runId, {
      type: "status",
      status: "implementing",
      text: "Event 7 Live",
    });

    const liveEvents = await livePromise;
    expect(liveEvents[0]).toContain("Event 7 Live");

    await reader2?.cancel();
  });

  it("supports gapless replay via last_event_id query parameter fallback", async () => {
    const { eventRepo, runId } = setupTest();

    eventRepo.appendEvent(runId, "status", { num: 1 });
    eventRepo.appendEvent(runId, "status", { num: 2 });
    eventRepo.appendEvent(runId, "status", { num: 3 });
    eventRepo.appendEvent(runId, "status", { num: 4 });

    const req = new Request(
      `http://localhost/api/runs/${runId}/events?last_event_id=2`,
    );
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const events = await readEvents(reader, 2);
    expect(events.length).toBe(2);

    const text = events.join("\n");
    expect(text).not.toContain('"num":1');
    expect(text).not.toContain('"num":2');
    expect(text).toContain('"num":3');
    expect(text).toContain('"num":4');

    await reader?.cancel();
  });
});
