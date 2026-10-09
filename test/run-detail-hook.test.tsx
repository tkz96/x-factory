// test/run-detail-hook.test.tsx — useRunDetail is a thin binding over lib/run-state (#191).
// Seam: the hook is rendered with a seeded query cache; the EventSource constructor is the only fake.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { useRunDetail } from "../src/frontend/hooks/useRunDetail.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

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
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  } as Run;
}

function Probe({ runId }: { runId: string }) {
  const { run, events, connected } = useRunDetail(runId);
  return React.createElement(
    "div",
    { "data-testid": "probe" },
    `${run?.status ?? "none"}|${events.length}|${connected ? "live" : "down"}`,
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

    source?.onerror?.();

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
    expect(view.getByTestId("probe").textContent).toBe("executing|1|down");
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual([
      `/api/runs/${runId}/events`,
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
    source?.onerror?.();
    expect(source?.closed).toBe(true);
    // The error closed the replay, so it is not reopened.
    expect(FakeEventSource.instances).toHaveLength(1);
    view.unmount();
    cleanup();
  });
});
