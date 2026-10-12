// test/app-events-reconnect.test.ts — The app-wide stream reconnects with its
// processed cursor, in the URL, and never moves the cursor past an event it did not
// apply (#264, spec #241 "The recovery contract").

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  type AppEventTransport,
  defaultAppEventTransport,
  subscribeAppEvents,
} from "../src/frontend/lib/app-events.js";
import type { AppEventEnvelope } from "../src/shared/types.js";

const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

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
  await unregisterHappyDom();
});

function statusEnvelope(id: number): AppEventEnvelope {
  return {
    id,
    runId: "run-1",
    sequence: id,
    type: "status",
    payload: { status: "awaiting_plan_approval" },
    time: "2026-10-11T00:00:00.000Z",
    ticket: { id: "T-1", title: "Ticket", acceptanceCriteria: [] },
    project: { id: "p1", name: "Project 1" },
  } as unknown as AppEventEnvelope;
}

/** A transport that records every connection and lets the test drive its handlers. */
function recordingTransport() {
  const connections: Array<{
    cursor: number;
    closed: boolean;
    message: (envelope: AppEventEnvelope) => void;
    error: () => void;
    open: () => void;
  }> = [];
  const transport: AppEventTransport = (cursor, handlers) => {
    const connection = {
      cursor,
      closed: false,
      message: (envelope: AppEventEnvelope) =>
        handlers.onMessage(JSON.stringify(envelope)),
      error: () => handlers.onError(),
      open: () => handlers.onOpen(),
    };
    connections.push(connection);
    return () => {
      connection.closed = true;
    };
  };
  return { connections, transport };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("app-wide stream reconnection (#264)", () => {
  it("on a dropped stream it closes the connection and reopens from the last applied cursor", async () => {
    const { connections, transport } = recordingTransport();
    const states: boolean[] = [];
    const stop = subscribeAppEvents({
      queryClient: new QueryClient(),
      initialCursor: 10,
      transport,
      retryDelayMs: () => 0,
      onConnectionChange: (connected) => states.push(connected),
    });

    connections[0]?.open();
    connections[0]?.message(statusEnvelope(11));
    connections[0]?.message(statusEnvelope(12));
    connections[0]?.error();

    expect(connections[0]?.closed).toBe(true);
    expect(states).toEqual([true, false]);

    await nextTick();
    expect(connections).toHaveLength(2);
    expect(connections[1]?.cursor).toBe(12);

    connections[1]?.open();
    expect(states).toEqual([true, false, true]);
    stop();
  });

  it("does not move the cursor past an event it failed to apply, and replays that event on reconnect", async () => {
    const { connections, transport } = recordingTransport();
    let failOnce = true;
    const applied: number[] = [];
    const stop = subscribeAppEvents({
      queryClient: new QueryClient(),
      initialCursor: 20,
      transport,
      retryDelayMs: () => 0,
      onEvent: (envelope) => {
        if (envelope.id === 22 && failOnce) {
          failOnce = false;
          throw new Error("storage exploded");
        }
        applied.push(envelope.id);
      },
    });

    connections[0]?.open();
    connections[0]?.message(statusEnvelope(21));
    connections[0]?.message(statusEnvelope(22));
    // The failed event closes this connection; the next one must not see 23 first.
    expect(connections[0]?.closed).toBe(true);
    connections[0]?.message(statusEnvelope(23));

    await nextTick();
    expect(connections[1]?.cursor).toBe(21);

    connections[1]?.message(statusEnvelope(22));
    connections[1]?.message(statusEnvelope(23));
    expect(applied).toEqual([21, 22, 23]);
    stop();
  });

  it("drops a replayed event by its global id", () => {
    const { connections, transport } = recordingTransport();
    const applied: number[] = [];
    const stop = subscribeAppEvents({
      queryClient: new QueryClient(),
      initialCursor: 0,
      transport,
      onEvent: (envelope) => applied.push(envelope.id),
    });
    connections[0]?.open();
    connections[0]?.message(statusEnvelope(5));
    connections[0]?.message(statusEnvelope(5));
    expect(applied).toEqual([5]);
    stop();
  });

  it("stop() cancels a pending reconnect", async () => {
    const { connections, transport } = recordingTransport();
    const stop = subscribeAppEvents({
      queryClient: new QueryClient(),
      initialCursor: 1,
      transport,
      retryDelayMs: () => 0,
    });
    connections[0]?.error();
    stop();
    await nextTick();
    expect(connections).toHaveLength(1);
  });

  it("the production transport closes its EventSource on error so the client can reopen it with the new cursor", () => {
    FakeEventSource.instances = [];
    const close = defaultAppEventTransport(7, {
      onOpen: () => {},
      onMessage: () => {},
      onError: () => {},
    });
    const source = FakeEventSource.instances[0];
    source?.onerror?.();
    expect(source?.closed).toBe(true);
    close();
  });
});
