// test/app-events-client.test.ts — Unit tests for client app-wide events subscriber, transport, hook and cache updates (#257).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import React from "react";
import { useAppEvents } from "../src/frontend/hooks/useAppEvents.js";
import {
  defaultAppEventTransport,
  fetchEventsSnapshot,
  subscribeAppEvents,
} from "../src/frontend/lib/app-events.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunStatus,
} from "../src/shared/types.js";

const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;
const RealFetch = globalThis.fetch;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;

afterAll(async () => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    RealEventSource;
  globalThis.fetch = RealFetch;
  await unregisterHappyDom();
});

function createTestRun(id: string, status: RunStatus = "planning"): Run {
  return {
    id,
    project: { id: "p1", name: "Project 1" },
    ticket: { id: "T-1", title: "Ticket", acceptanceCriteria: [] },
    plan: "",
    branch: `feat/${id}`,
    status,
    startedAt: "2026-10-11T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-11T00:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  };
}

describe("Client app-wide event subscriber (#257)", () => {
  it("deduplicates events by global ID and applies each event idempotently", () => {
    const queryClient = new QueryClient();
    const run = createTestRun("run-dedupe", "planning");
    queryClient.setQueryData(queryKeys.run("run-dedupe"), run);
    queryClient.setQueryData(queryKeys.runs(), [run]);

    const receivedEvents: AppEventEnvelope[] = [];
    let messageHandler: (data: string) => void = () => {};

    const stop = subscribeAppEvents({
      queryClient,
      initialCursor: 10,
      transport: (_cursor, handlers) => {
        messageHandler = handlers.onMessage;
        return () => {};
      },
      onEvent: (e) => receivedEvents.push(e),
    });

    const envelope: AppEventEnvelope = {
      id: 11,
      runId: "run-dedupe",
      sequence: 2,
      type: "status",
      payload: { status: "awaiting_plan_approval", text: "Plan ready" },
      time: "2026-10-11T00:01:00.000Z",
      ticket: run.ticket,
      project: run.project,
    };

    // Deliver first time
    messageHandler(JSON.stringify(envelope));
    expect(receivedEvents.length).toBe(1);

    // Verify cache was patched directly
    const cachedRun = queryClient.getQueryData<Run>(
      queryKeys.run("run-dedupe"),
    );
    expect(cachedRun?.status).toBe("awaiting_plan_approval");

    // Deliver exact same event second time (replayed or duplicate)
    messageHandler(JSON.stringify(envelope));
    // Must be deduplicated! onEvent not called again
    expect(receivedEvents.length).toBe(1);

    stop();
  });

  it("marks an event live only when it was created after the connection was requested (#265)", () => {
    const queryClient = new QueryClient();
    const run = createTestRun("run-live", "planning");
    queryClient.setQueryData(queryKeys.run("run-live"), run);

    const seen: { id: number; live: boolean }[] = [];
    let messageHandler: (data: string) => void = () => {};

    const stop = subscribeAppEvents({
      queryClient,
      initialCursor: 10,
      transport: (_cursor, handlers) => {
        messageHandler = handlers.onMessage;
        handlers.onOpen();
        return () => {};
      },
      onEvent: (e, meta) => seen.push({ id: e.id, live: meta.live }),
    });

    const base = {
      runId: "run-live",
      sequence: 2,
      type: "status",
      payload: { status: "awaiting_plan_approval" },
      ticket: run.ticket,
      project: run.project,
    };
    // Created before this connection existed: a replay on resume, never live.
    messageHandler(
      JSON.stringify({ ...base, id: 11, time: "2026-10-11T00:01:00.000Z" }),
    );
    // Created after the connection was requested: live.
    messageHandler(
      JSON.stringify({ ...base, id: 12, time: new Date().toISOString() }),
    );

    expect(seen).toEqual([
      { id: 11, live: false },
      { id: 12, live: true },
    ]);
    stop();
  });

  it("patches run cache and runs list directly on status event without flicker", () => {
    const queryClient = new QueryClient();
    const run1 = createTestRun("run-1", "planning");
    const run2 = createTestRun("run-2", "executing");
    queryClient.setQueryData(queryKeys.run("run-1"), run1);
    queryClient.setQueryData(queryKeys.runs(), [run1, run2]);

    let messageHandler: (data: string) => void = () => {};
    let errorHandler: () => void = () => {};
    const connectionStates: boolean[] = [];

    const stop = subscribeAppEvents({
      queryClient,
      initialCursor: 0,
      transport: (_cursor, handlers) => {
        messageHandler = handlers.onMessage;
        errorHandler = handlers.onError;
        handlers.onOpen();
        return () => {};
      },
      onConnectionChange: (state) => connectionStates.push(state),
    });

    expect(connectionStates).toEqual([true]);

    const transitionEnvelope: AppEventEnvelope = {
      id: 5,
      runId: "run-1",
      sequence: 2,
      type: "status",
      payload: { status: "awaiting_plan_approval" },
      time: "2026-10-11T00:02:00.000Z",
      ticket: run1.ticket,
      project: run1.project,
    };

    messageHandler(JSON.stringify(transitionEnvelope));

    // Both individual run query and list query are patched directly
    const updatedRun1 = queryClient.getQueryData<Run>(queryKeys.run("run-1"));
    expect(updatedRun1?.status).toBe("awaiting_plan_approval");

    const updatedRuns = queryClient.getQueryData<Run[]>(queryKeys.runs());
    expect(updatedRuns?.find((r) => r.id === "run-1")?.status).toBe(
      "awaiting_plan_approval",
    );
    expect(updatedRuns?.find((r) => r.id === "run-2")?.status).toBe(
      "executing",
    );

    // Non-status event ignored for status cache patching but forwarded to onEvent
    const infoEnvelope: AppEventEnvelope = {
      id: 6,
      runId: "run-1",
      sequence: 3,
      type: "info",
      payload: { text: "Step executed" },
      time: "2026-10-11T00:03:00.000Z",
      ticket: run1.ticket,
      project: run1.project,
    };
    messageHandler(JSON.stringify(infoEnvelope));

    // Malformed JSON message is safely ignored
    messageHandler("not-valid-json");

    // Error handler triggers onConnectionChange(false)
    errorHandler();
    expect(connectionStates).toEqual([true, false]);

    stop();
  });

  it("fetchEventsSnapshot makes GET request and parses response", async () => {
    const mockSnapshot: EventsSnapshot = {
      cursor: 42,
      runs: [],
      needsYou: [],
      finished: [],
    };

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.endsWith("/api/events/snapshot")) {
        return new Response(JSON.stringify(mockSnapshot), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const data = await fetchEventsSnapshot();
    expect(data.cursor).toBe(42);
    expect(data.runs).toEqual([]);
  });

  it("fetchEventsSnapshot throws when response is not ok", async () => {
    globalThis.fetch = (async () => {
      return new Response("Internal error", { status: 500 });
    }) as unknown as typeof globalThis.fetch;

    await expect(fetchEventsSnapshot()).rejects.toThrow(
      "Failed to fetch events snapshot: 500",
    );
  });

  it("defaultAppEventTransport connects via EventSource and delegates events", () => {
    FakeEventSource.instances = [];
    let opened = false;
    let receivedData = "";
    let errored = false;

    const close = defaultAppEventTransport(25, {
      onOpen: () => {
        opened = true;
      },
      onMessage: (data) => {
        receivedData = data;
      },
      onError: () => {
        errored = true;
      },
    });

    expect(FakeEventSource.instances.length).toBe(1);
    const instance = FakeEventSource.instances[0];
    if (!instance) throw new Error("Missing EventSource instance");

    expect(instance.url).toBe("/api/events?last_event_id=25");

    instance.onopen?.();
    expect(opened).toBe(true);

    instance.onmessage?.({ data: '{"id":26}' });
    expect(receivedData).toBe('{"id":26}');

    instance.onerror?.();
    expect(errored).toBe(true);

    close();
    expect(instance.closed).toBe(true);
  });

  it("useAppEvents hook mounts and reads snapshot query", () => {
    const queryClient = new QueryClient();
    const mockSnapshot: EventsSnapshot = {
      cursor: 100,
      runs: [],
      needsYou: [],
      finished: [],
    };
    queryClient.setQueryData(queryKeys.eventsSnapshot(), mockSnapshot);

    function Probe() {
      const { snapshot, cursor, connected } = useAppEvents({
        transport: (_cursor, handlers) => {
          handlers.onOpen();
          return () => {};
        },
      });
      return React.createElement(
        "div",
        { "data-testid": "probe" },
        `${snapshot ? "ready" : "none"}|${cursor ?? -1}|${connected ? "yes" : "no"}`,
      );
    }

    const rendered = render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Probe),
      ),
    );

    const probeEl = rendered.getByTestId("probe");
    expect(probeEl.textContent).toBe("ready|100|yes");
  });
});
