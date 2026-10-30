// test/run-page-resilience.test.tsx — The run page through a server outage (spec #312, ticket 314,
// user stories 3–4): the page stays with a connection banner while the server cannot be reached, and
// "Run Not Found" appears only when the server says the run is not there.
// Extended for #317: connection banner also shows when event stream is reconnecting.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunDetailView } from "../src/frontend/views/RunDetailView.js";
import type { Run, RunStatus } from "../src/shared/types.js";

const realFetch = globalThis.fetch;
const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readyState = 0;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  FakeEventSource.instances = [];
});
afterAll(async () => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    RealEventSource;
  await unregisterHappyDom();
});

function makeRun(id: string, status: RunStatus): Run {
  return {
    id,
    project: { id: "p", name: "P" },
    ticket: {
      id: `T-${id}`,
      title: `Ticket ${id}`,
      description: `What ${id} is about.`,
      url: "",
      acceptanceCriteria: [],
    },
    plan: "1. Do the thing.",
    branch: `factory/${id}`,
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
  } as unknown as Run;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The request fails the way a server that cannot be reached fails. */
const unreachable = (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

/**
 * Renders the run page on `/runs/run-1`. `cached` seeds the snapshot the page already has; `answer`
 * decides each request's response.
 */
function renderRunPage(
  answer: (method: string, url: string) => Promise<Response> | Response,
  cached: Run | null,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    answer(init?.method ?? "GET", String(input))) as unknown as typeof fetch;
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached) {
    client.setQueryData(queryKeys.run("run-1"), cached);
  }
  client.setQueryData(queryKeys.runEvents("run-1"), []);
  const view = render(
    <QueryClientProvider client={client}>
      <ModalProvider>
        <MemoryRouter initialEntries={["/runs/run-1"]}>
          <Routes>
            <Route path="/runs/:runId" element={<RunDetailView />} />
          </Routes>
        </MemoryRouter>
      </ModalProvider>
    </QueryClientProvider>,
  );
  return { view, client };
}

describe("the run page through a short server outage", () => {
  it("keeps the page and says the connection is lost when a refresh fails", async () => {
    const { view, client } = renderRunPage(
      unreachable,
      makeRun("run-1", "executing"),
    );

    // The snapshot is on screen; the next refresh cannot reach the server.
    await client.refetchQueries({ queryKey: queryKeys.run("run-1") });

    await view.findByText("Connection lost");
    expect(view.queryByText("Run Not Found")).toBeNull();
    expect(view.getByText(/is retrying/i)).toBeTruthy();
  });

  it("shows Run Not Found when the server says the run does not exist", async () => {
    const { view } = renderRunPage(
      () => json({ error: "Run not found", code: "NOT_FOUND" }, 404),
      null,
    );

    await view.findByText("Run Not Found");
    expect(view.queryByText("Connection lost")).toBeNull();
  });

  it("does not claim the run is missing when the first load cannot reach the server", async () => {
    const { view } = renderRunPage(unreachable, null);

    await view.findByText("Connection lost");
    expect(view.queryByText("Run Not Found")).toBeNull();
  });

  it("drops the connection banner once a refresh succeeds again", async () => {
    let reachable = false;
    const { view, client } = renderRunPage(
      () => {
        if (!reachable) return unreachable();
        return json(makeRun("run-1", "executing"));
      },
      makeRun("run-1", "executing"),
    );

    await client.refetchQueries({ queryKey: queryKeys.run("run-1") });
    await view.findByText("Connection lost");

    reachable = true;
    await client.refetchQueries({ queryKey: queryKeys.run("run-1") });
    await waitForElementToBeRemoved(() => view.queryByText("Connection lost"));
  });

  it("shows the connection banner when the event stream is reconnecting on an active run (#317)", async () => {
    const { view } = renderRunPage(
      () => json(makeRun("run-1", "executing")),
      makeRun("run-1", "executing"),
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];

    // Stream opens initially
    act(() => {
      source?.onopen?.();
    });
    expect(view.queryByText("Connection lost")).toBeNull();

    // Event stream drops on active run -> reconnecting banner appears
    act(() => {
      source?.onerror?.();
    });
    await view.findByText("Connection lost");
    expect(view.getByText(/is retrying/i)).toBeTruthy();

    // Event stream reconnects -> banner disappears
    act(() => {
      source?.onopen?.();
    });
    expect(view.queryByText("Connection lost")).toBeNull();
  });

  it("does not show the connection banner when a finished run's stream ends normally (#317)", async () => {
    const { view } = renderRunPage(
      () => json(makeRun("run-1", "pr_created")),
      makeRun("run-1", "pr_created"),
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];

    // Finished run stream ends normally (replay ended)
    act(() => {
      source?.onerror?.();
    });
    expect(view.queryByText("Connection lost")).toBeNull();
  });
});
