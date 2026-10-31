// test/run-detail-hook.test.tsx — useRunDetail is a thin binding over lib/run-state (#191).
// Seam: the hook is rendered with a seeded query cache; the EventSource constructor is the only fake.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { useRunDetail } from "../src/frontend/hooks/useRunDetail.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { eventSourceTransport } from "../src/frontend/lib/run-state.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  readyState = 0;
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

function runSnapshot(id: string, status: RunStatus): Run {
  return {
    id,
    project: { id: "proj-hook", name: "Hook project" },
    ticket: { id: "H-1", title: "Hook", acceptanceCriteria: [] },
    plan: "plan",
    branch: "factory/hook",
    status,
    startedAt: "2026-10-01T10:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
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

function Probe({ runId }: { runId: string }) {
  const { run, events, connected, eventsLoaded, reconnecting } =
    useRunDetail(runId);
  return React.createElement(
    "div",
    { "data-testid": "probe" },
    `${run?.status ?? "none"}|${events.length}|${connected ? "live" : "down"}|${eventsLoaded ? "loaded" : "loading"}|${reconnecting ? "reconnecting" : "steady"}`,
  );
}

function mountProbe(client: QueryClient, runId: string) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { runId }),
    ),
  );
}

/** The refetch interval the mounted run query actually uses, resolved from its live observer. */
function effectiveRefetchInterval(client: QueryClient, runId: string): unknown {
  const query = client.getQueryCache().find({ queryKey: queryKeys.run(runId) });
  const observer = query?.observers[0];
  const option = observer?.options.refetchInterval;
  if (!query || !observer || option === undefined) return undefined;
  return typeof option === "function" ? option(query) : option;
}

describe("useRunDetail (#191)", () => {
  it("keeps the active run's 2 s polling after its stream drops", () => {
    FakeEventSource.instances = [];
    const runId = "localhost-3777-run-dropped";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));

    const view = mountProbe(client, runId);
    const source = FakeEventSource.instances[0];
    expect(effectiveRefetchInterval(client, runId)).toBe(2000);

    act(() => {
      source?.onerror?.();
    });

    expect(source?.closed).toBe(false);
    expect(effectiveRefetchInterval(client, runId)).toBe(2000);
    view.unmount();
    cleanup();
  });

  it("returns the cached snapshot and event log, and opens one live stream for an active run", () => {
    FakeEventSource.instances = [];
    const runId = "run-hook-active";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));
    const seeded: RunEvent[] = [
      {
        id: 1,
        timestamp: "2026-10-01T10:00:00.000Z",
        type: "chat_agent",
        payload: { text: "Hi" },
      },
    ];
    client.setQueryData(queryKeys.runEvents(runId), seeded);

    const view = mountProbe(client, runId);
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|1|down|loaded|steady",
    );
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual([
      `/api/runs/${runId}/events?last_event_id=1`,
    ]);

    view.unmount();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    cleanup();
  });

  it("opens a replay-only stream for a finished run and closes it when the server ends the replay", () => {
    FakeEventSource.instances = [];
    const runId = "run-hook-finished";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "pr_created"));

    const view = mountProbe(client, runId);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    act(() => {
      source?.onerror?.();
    });
    expect(source?.closed).toBe(true);
    // The error closed the replay, so it is not reopened.
    expect(FakeEventSource.instances).toHaveLength(1);
    view.unmount();
    cleanup();
  });

  it("exposes eventsLoaded as false initially, and true once the stream has opened or events arrive (#313)", () => {
    FakeEventSource.instances = [];
    const runId = "run-hook-loading";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));

    const view = mountProbe(client, runId);
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|down|loading|steady",
    );

    const source = FakeEventSource.instances[0];
    act(() => {
      source?.onopen?.();
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|live|loaded|steady",
    );

    // Even if the connection temporarily drops, eventsLoaded stays true
    act(() => {
      act(() => {
        source?.onerror?.();
      });
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|down|loaded|reconnecting",
    );

    view.unmount();
    cleanup();
  });

  it("does not restart the subscription when an active run becomes terminal while watching (#317)", () => {
    FakeEventSource.instances = [];
    const runId = "run-terminal-transition";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));

    const view = mountProbe(client, runId);
    expect(FakeEventSource.instances).toHaveLength(1);
    const initialSource = FakeEventSource.instances[0];

    act(() => {
      initialSource?.onopen?.();
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|live|loaded|steady",
    );

    // The run transitions to terminal (e.g. pr_created)
    act(() => {
      client.setQueryData(
        queryKeys.run(runId),
        runSnapshot(runId, "pr_created"),
      );
    });

    // The subscription must NOT restart: no new EventSource instance created
    expect(FakeEventSource.instances).toHaveLength(1);

    // When the server closes the stream, the stream closes and is not reconnecting
    act(() => {
      initialSource?.onerror?.();
    });
    expect(initialSource?.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(view.getByTestId("probe").textContent).toBe(
      "pr_created|0|down|loaded|steady",
    );

    view.unmount();
    cleanup();
  });

  it("reports reconnecting when an active run's stream drops, and steady when reconnected (#317)", () => {
    FakeEventSource.instances = [];
    const runId = "run-reconnecting";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));

    const view = mountProbe(client, runId);
    const source = FakeEventSource.instances[0];
    act(() => {
      source?.onopen?.();
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|live|loaded|steady",
    );

    act(() => {
      act(() => {
        source?.onerror?.();
      });
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|down|loaded|reconnecting",
    );

    act(() => {
      source?.onopen?.();
    });
    expect(view.getByTestId("probe").textContent).toBe(
      "executing|0|live|loaded|steady",
    );

    view.unmount();
    cleanup();
  });

  it("judges each run's own stream by that run's status when the page moves to another run (#317)", () => {
    FakeEventSource.instances = [];
    const finishedId = "run-hook-prev-finished";
    const activeId = "run-hook-next-active";
    const client = new QueryClient();
    client.setQueryData(
      queryKeys.run(finishedId),
      runSnapshot(finishedId, "pr_created"),
    );
    client.setQueryData(
      queryKeys.run(activeId),
      runSnapshot(activeId, "executing"),
    );
    const tree = (id: string) =>
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(Probe, { runId: id }),
      );
    const view = render(tree(finishedId));
    view.rerender(tree(activeId));
    const source = FakeEventSource.instances.find((s) =>
      s.url.includes(activeId),
    );
    act(() => {
      source?.onerror?.();
    });
    // The active run keeps its stream and reports the retry; the earlier run's replay-only mode must not leak.
    expect(source?.closed).toBe(false);
    expect(view.getByTestId("probe").textContent).toContain("reconnecting");
    view.unmount();
    cleanup();
  });

  it("starts the stream from lastAppliedId when events are already in cache (#317)", () => {
    FakeEventSource.instances = [];
    const runId = "run-last-applied";
    const client = new QueryClient();
    client.setQueryData(queryKeys.run(runId), runSnapshot(runId, "executing"));
    client.setQueryData(queryKeys.runEvents(runId), [
      {
        id: 42,
        timestamp: "2026-10-01T10:00:00.000Z",
        type: "info",
        payload: { message: "cached" },
      },
    ]);

    const view = mountProbe(client, runId);
    expect(FakeEventSource.instances[0]?.url).toBe(
      `/api/runs/${runId}/events?last_event_id=42`,
    );

    view.unmount();
    cleanup();
  });
});

describe("eventSourceTransport (#191)", () => {
  it("opens from the cursor in the query and reports a permanent failure only when the browser has closed the stream", () => {
    FakeEventSource.instances = [];
    const calls: boolean[] = [];
    const handlers = {
      onOpen: () => {},
      onMessage: () => {},
      onError: (permanent: boolean) => calls.push(permanent),
    };

    const fresh = eventSourceTransport("run-transport", 0, handlers);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/runs/run-transport/events",
    );
    const resumed = eventSourceTransport("run-transport", 2, handlers);
    expect(FakeEventSource.instances[1]?.url).toBe(
      "/api/runs/run-transport/events?last_event_id=2",
    );

    // The browser is still retrying: not permanent.
    const retrying = FakeEventSource.instances[1];
    if (retrying) retrying.readyState = 0;
    retrying?.onerror?.();
    // The browser has given up (EventSource.CLOSED): permanent.
    if (retrying) retrying.readyState = 2;
    retrying?.onerror?.();

    expect(calls).toEqual([false, true]);
    fresh();
    resumed();
    expect(FakeEventSource.instances[1]?.closed).toBe(true);
  });
});
