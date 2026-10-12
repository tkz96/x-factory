// test/run-page-actions.test.tsx — The run page's checkpoint actions as the user meets them (#262):
// the pending label and disabled siblings, the moved-on message, and Start New Run, which opens the
// existing run on conflict and leaves the old run alone.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunDetailView } from "../src/frontend/views/RunDetailView.js";
import type { Run, RunStatus } from "../src/shared/types.js";

const realFetch = globalThis.fetch;
const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

/** Renders the run page on `/runs/run-1`; `answer` decides each request's response. */
function renderRunPage(
  status: RunStatus,
  answer: (
    method: string,
    url: string,
    body: unknown,
  ) => Promise<Response> | Response,
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, body });
    return answer(method, url, body);
  }) as unknown as typeof fetch;
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.run("run-1"), makeRun("run-1", status));
  client.setQueryData(queryKeys.runEvents("run-1"), []);
  const view = render(
    <QueryClientProvider client={client}>
      <ModalProvider>
        <MemoryRouter initialEntries={["/runs/run-1"]}>
          <LocationProbe />
          <Routes>
            <Route path="/runs/:runId" element={<RunDetailView />} />
          </Routes>
        </MemoryRouter>
      </ModalProvider>
    </QueryClientProvider>,
  );
  return { view, requests };
}

const location = (container: HTMLElement) =>
  within(container).getByTestId("location").textContent;

describe("the pressed checkpoint action shows its pending state", () => {
  it("labels Approve Plan as Approving and disables Request Changes until the run answers", async () => {
    const { view, requests } = renderRunPage(
      "awaiting_plan_approval",
      async (method, url) => {
        if (method === "POST" && url.endsWith("/transitions")) {
          // The run answers a little later, so the pending state is on screen first.
          await new Promise((resolve) => setTimeout(resolve, 300));
          return json({ run: makeRun("run-1", "executing") });
        }
        return json(makeRun("run-1", "awaiting_plan_approval"));
      },
    );

    fireEvent.click(view.getByRole("button", { name: "Approve Plan" }));

    const approving = await view.findByRole("button", { name: "Approving…" });
    expect((approving as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        view.getByRole("button", {
          name: "Request Changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      action: "approve",
    });
  });
});

describe("an action that raced with the run says so", () => {
  it("shows the moved-on message when the run answers with a conflict", async () => {
    const { view } = renderRunPage("awaiting_plan_approval", (method, url) => {
      if (method === "POST" && url.endsWith("/transitions")) {
        return json({ error: "Illegal transition" }, 409);
      }
      return json(makeRun("run-1", "awaiting_plan_approval"));
    });

    fireEvent.click(view.getByRole("button", { name: "Approve Plan" }));

    const alert = await view.findByRole("alert");
    expect(alert.textContent).toBe(
      "This run already moved on. Showing the latest.",
    );
  });
});

describe("Start New Run on a finished run", () => {
  it("opens the existing active run when the ticket already has one, and leaves this run alone", async () => {
    const { view, requests } = renderRunPage("failed", (method, url) => {
      if (method === "POST" && url.endsWith("/api/runs")) {
        return json(
          {
            code: "RUN_ALREADY_ACTIVE",
            error: "This ticket already has an active run.",
            runId: "run-9",
          },
          409,
        );
      }
      return json(makeRun("run-1", "failed"));
    });

    fireEvent.click(view.getByRole("button", { name: "Start New Run" }));

    await waitFor(() => expect(location(view.container)).toBe("/runs/run-9"));
    expect(
      requests.some(
        (r) => r.method === "POST" && r.url.includes("/transitions"),
      ),
    ).toBe(false);
    expect(requests.some((r) => r.url.endsWith("/stop"))).toBe(false);
  });

  it("creates a separate run for the same ticket and opens it", async () => {
    const { view, requests } = renderRunPage("stopped", (method, url) => {
      if (method === "POST" && url.endsWith("/api/runs")) {
        return json(makeRun("run-2", "queued"), 201);
      }
      return json(makeRun("run-1", "stopped"));
    });

    fireEvent.click(view.getByRole("button", { name: "Start New Run" }));

    await waitFor(() => expect(location(view.container)).toBe("/runs/run-2"));
    const create = requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/api/runs"),
    );
    expect(create?.body).toMatchObject({ projectId: "p", ticketId: "T-run-1" });
  });
});
