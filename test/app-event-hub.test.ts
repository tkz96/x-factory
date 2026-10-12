// test/app-event-hub.test.ts — One shared poller behind the app-wide event stream (#257, spec #241).

import { describe, expect, it } from "bun:test";
import {
  AppEventHub,
  type AppEventSubscriber,
} from "../src/http/app-event-hub.js";
import type { AppEventEnvelope } from "../src/shared/types.js";

function envelope(id: number): AppEventEnvelope {
  return {
    id,
    runId: "run-1",
    sequence: id,
    type: "status",
    payload: { status: "executing", text: String(id) },
    time: "2026-01-01T00:00:00.000Z",
    ticket: { id: "T-1", title: "t", acceptanceCriteria: [] },
    project: { id: "p", name: "P" },
  } as AppEventEnvelope;
}

function makeStore() {
  const events: AppEventEnvelope[] = [];
  const calls: Array<{ sinceId: number; limit: number }> = [];
  return {
    events,
    calls,
    append(count: number) {
      for (let i = 0; i < count; i++) events.push(envelope(events.length + 1));
    },
    read(sinceId: number, limit: number) {
      calls.push({ sinceId, limit });
      return events.filter((e) => e.id > sinceId).slice(0, limit);
    },
  };
}

function collector() {
  const ids: number[] = [];
  const errors: unknown[] = [];
  const subscriber: AppEventSubscriber = {
    onEvents: (events) => {
      for (const e of events) ids.push(e.id);
    },
    onError: (error) => errors.push(error),
  };
  return { ids, errors, subscriber };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AppEventHub", () => {
  it("two subscribers share one poll per tick", async () => {
    const store = makeStore();
    const hub = new AppEventHub(store.read.bind(store), { pollMs: 20 });
    const a = collector();
    const b = collector();
    const offA = hub.subscribe(0, a.subscriber);
    const offB = hub.subscribe(0, b.subscriber);
    store.calls.length = 0;

    store.append(2);
    await wait(100);
    offA();
    offB();

    expect(a.ids).toEqual([1, 2]);
    expect(b.ids).toEqual([1, 2]);
    // Every poll read starts at the shared head, never once per subscriber.
    const productive = store.calls.filter((c) => c.sinceId === 0);
    expect(productive.length).toBe(1);
  });

  it("replays a stale cursor in pages, in order, without gaps", () => {
    const store = makeStore();
    store.append(23);
    const hub = new AppEventHub(store.read.bind(store), {
      pollMs: 1000,
      pageSize: 5,
    });
    const a = collector();
    const off = hub.subscribe(3, a.subscriber);
    off();

    expect(a.ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 4));
    expect(store.calls.every((c) => c.limit === 5)).toBe(true);
    expect(store.calls.length).toBeGreaterThan(1);
  });

  it("a late subscriber replays only up to the shared head, then goes live without duplicates", async () => {
    const store = makeStore();
    store.append(3);
    const hub = new AppEventHub(store.read.bind(store), { pollMs: 20 });
    const first = collector();
    const offFirst = hub.subscribe(0, first.subscriber);
    const late = collector();
    const offLate = hub.subscribe(1, late.subscriber);
    store.append(1);
    await wait(80);
    offFirst();
    offLate();

    expect(first.ids).toEqual([1, 2, 3, 4]);
    expect(late.ids).toEqual([2, 3, 4]);
  });

  it("stops polling when the last subscriber closes and restarts with the next", async () => {
    const store = makeStore();
    const hub = new AppEventHub(store.read.bind(store), { pollMs: 20 });
    const a = collector();
    const b = collector();
    const offA = hub.subscribe(0, a.subscriber);
    const offB = hub.subscribe(0, b.subscriber);
    expect(hub.isPolling).toBe(true);
    offA();
    expect(hub.isPolling).toBe(true);
    offB();
    expect(hub.isPolling).toBe(false);
    expect(hub.subscriberCount).toBe(0);

    store.calls.length = 0;
    await wait(80);
    expect(store.calls.length).toBe(0);

    const c = collector();
    const offC = hub.subscribe(0, c.subscriber);
    expect(hub.isPolling).toBe(true);
    offC();
  });

  it("logs a poll failure and tells every subscriber", async () => {
    const store = makeStore();
    let fail = false;
    const logged: string[] = [];
    const hub = new AppEventHub(
      (since, limit) => {
        if (fail) throw new Error("db gone");
        return store.read(since, limit);
      },
      { pollMs: 20, log: (m) => logged.push(m) },
    );
    const a = collector();
    hub.subscribe(0, a.subscriber);
    fail = true;
    await wait(80);

    expect(a.errors.length).toBe(1);
    expect(logged.length).toBe(1);
    expect(hub.isPolling).toBe(false);
    expect(hub.subscriberCount).toBe(0);
  });

  it("reports a failed replay and subscribes nothing", () => {
    const logged: string[] = [];
    const hub = new AppEventHub(
      () => {
        throw new Error("boom");
      },
      { log: (m) => logged.push(m) },
    );
    const a = collector();
    hub.subscribe(0, a.subscriber);
    expect(a.errors.length).toBe(1);
    expect(hub.isPolling).toBe(false);
  });

  it("drops a subscriber whose delivery throws without disturbing the others", async () => {
    const store = makeStore();
    const hub = new AppEventHub(store.read.bind(store), {
      pollMs: 20,
      log: () => {},
    });
    const good = collector();
    const bad = collector();
    const badErrors: unknown[] = [];
    hub.subscribe(0, good.subscriber);
    hub.subscribe(0, {
      onEvents: () => {
        throw new Error("closed");
      },
      onError: (e) => badErrors.push(e),
    });
    store.append(1);
    await wait(80);

    expect(good.ids).toEqual([1]);
    expect(badErrors.length).toBe(1);
    expect(hub.subscriberCount).toBe(1);
    void bad;
  });
});
