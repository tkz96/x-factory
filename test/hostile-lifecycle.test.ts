// test/hostile-lifecycle.test.ts — Hostile lifecycle scenarios: rapid switching, stream disruptions & subscriber isolation (XFM-66).

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { defaultEventBus } from "../src/events.js";
import { patchRunCache } from "../src/frontend/lib/query-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";
import type { Run, RunEventPayload } from "../src/shared/types.js";

describe("Hostile Lifecycle UI & Stream Scenarios (XFM-66)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
    const runRepo = new RunRepository(db);

    return { db, runRepo };
  }

  function createTestRun(id: string, runRepo: RunRepository): Run {
    return runRepo.create({
      id,
      projectId: "proj-hostile",
      projectName: "Hostile Lifecycle Project",
      ticket: { id: `T-${id}`, title: `Ticket ${id}`, acceptanceCriteria: [] },
      plan: "Plan",
      branch: `factory/${id}`,
      status: "implementing",
      artifactsDir: `/tmp/artifacts-${id}`,
      worktreePath: `/tmp/worktrees-${id}`,
    });
  }

  it("rapid run switching unsubscribes previous streams without cross-contaminating cache", async () => {
    const { runRepo } = setupTest();

    const runA = createTestRun("run-switch-A", runRepo);
    const runB = createTestRun("run-switch-B", runRepo);
    const runC = createTestRun("run-switch-C", runRepo);

    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(runA.id), runA);
    queryClient.setQueryData(queryKeys.run(runB.id), runB);
    queryClient.setQueryData(queryKeys.run(runC.id), runC);

    // Track active subscriber callbacks
    const eventsA: Array<RunEventPayload & { timestamp?: number }> = [];
    const eventsB: Array<RunEventPayload & { timestamp?: number }> = [];
    const eventsC: Array<RunEventPayload & { timestamp?: number }> = [];

    // 1. User views Run A
    const unsubA1 = defaultEventBus.subscribe(runA.id, (e) => {
      eventsA.push(e);
      if (e.type === "status") {
        patchRunCache(runA.id, { status: e.status }, queryClient);
      }
    });

    // 2. Rapid switch to Run B -> unsub A
    unsubA1();
    const unsubB = defaultEventBus.subscribe(runB.id, (e) => {
      eventsB.push(e);
      if (e.type === "status") {
        patchRunCache(runB.id, { status: e.status }, queryClient);
      }
    });

    // 3. Rapid switch to Run C -> unsub B
    unsubB();
    const unsubC = defaultEventBus.subscribe(runC.id, (e) => {
      eventsC.push(e);
      if (e.type === "status") {
        patchRunCache(runC.id, { status: e.status }, queryClient);
      }
    });

    // 4. Switch back to Run A -> unsub C
    unsubC();
    const unsubA2 = defaultEventBus.subscribe(runA.id, (e) => {
      eventsA.push(e);
      if (e.type === "status") {
        patchRunCache(runA.id, { status: e.status }, queryClient);
      }
    });

    // Emit event on Run B (which was unsubscribed)
    defaultEventBus.emit(runB.id, {
      type: "status",
      status: "failed",
      text: "Run failed",
    });

    // Emit event on Run A (which is currently active)
    defaultEventBus.emit(runA.id, {
      type: "status",
      status: "verifying",
      text: "Run verifying",
    });

    // Assert: eventsB did NOT receive event after unsub
    expect(eventsB.length).toBe(0);
    // Run B cache was NOT modified
    const cachedB = queryClient.getQueryData<Run>(queryKeys.run(runB.id));
    expect(cachedB?.status).toBe("implementing");

    // Assert: eventsA received only the active event
    expect(eventsA.length).toBe(1);
    expect(eventsA[0]?.type === "status" ? eventsA[0].status : null).toBe(
      "verifying",
    );
    const cachedA = queryClient.getQueryData<Run>(queryKeys.run(runA.id));
    expect(cachedA?.status).toBe("verifying");

    unsubA2();
  });

  it("abrupt SSE connection abort cleans up event bus listeners completely", async () => {
    const { runRepo } = setupTest();
    const run = createTestRun("run-disconnect-test", runRepo);

    // Initial listener count
    const initialListenerCount = defaultEventBus.listenerCount(run.id);

    // 1. Client connects via SSE
    const req = new Request(`http://localhost/api/runs/${run.id}/events`);
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    // Listener count should now be +1
    expect(defaultEventBus.listenerCount(run.id)).toBe(
      initialListenerCount + 1,
    );

    // 2. Client abruptly disconnects / cancels stream
    await reader?.cancel();

    // Give microtask tick for cancel() callback in ReadableStream to trigger
    await new Promise((r) => setTimeout(r, 10));

    // Listener count MUST return to initial count (0 zombie listeners)
    expect(defaultEventBus.listenerCount(run.id)).toBe(initialListenerCount);
  });

  it("broadcasts events independently to multiple concurrent subscribers without cross-talk", async () => {
    const { runRepo } = setupTest();
    const run1 = createTestRun("run-multi-sub-1", runRepo);
    const run2 = createTestRun("run-multi-sub-2", runRepo);

    // Two clients subscribe to run 1
    const sub1Events: string[] = [];
    const sub2Events: string[] = [];
    const unsub1 = defaultEventBus.subscribe(run1.id, (e) =>
      sub1Events.push(e.type),
    );
    const unsub2 = defaultEventBus.subscribe(run1.id, (e) =>
      sub2Events.push(e.type),
    );

    // One client subscribes to run 2
    const sub3Events: string[] = [];
    const unsub3 = defaultEventBus.subscribe(run2.id, (e) =>
      sub3Events.push(e.type),
    );

    // Emit event on run 1
    defaultEventBus.emit(run1.id, { type: "info", text: "Run 1 event" });

    // Emit event on run 2
    defaultEventBus.emit(run2.id, { type: "pr_step", text: "Run 2 event" });

    // Assert both run 1 subscribers got run 1 event
    expect(sub1Events).toEqual(["info"]);
    expect(sub2Events).toEqual(["info"]);

    // Assert run 2 subscriber got ONLY run 2 event
    expect(sub3Events).toEqual(["pr_step"]);

    unsub1();
    unsub2();
    unsub3();
  });
});
