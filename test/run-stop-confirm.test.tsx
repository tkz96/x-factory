// test/run-stop-confirm.test.tsx — Stop Run from the run page's "…" menu and from the palette asks
// first, naming the branch, and stops the run only on confirmation (#262).

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
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type { Project, Run } from "../src/shared/types.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
afterAll(async () => {
  await unregisterHappyDom();
});

const PROJECT = { id: "demo-app", name: "Demo App" } as Project;

function executingRun(): Run {
  return {
    id: "run-1",
    project: { id: PROJECT.id, name: PROJECT.name },
    ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
    plan: "",
    branch: "factory/t-1-stop-me",
    status: "executing",
    startedAt: "2026-10-01T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
  } as unknown as Run;
}

/** Records every request; stop answers with the run as stopped, everything else with an empty list. */
function stubFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/stop")) {
      return new Response(
        JSON.stringify({ run: { ...executingRun(), status: "stopped" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function renderRunPage() {
  const calls = stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  client.setQueryData(queryKeys.runs(), []);
  client.setQueryData(queryKeys.run("run-1"), executingRun());
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <MemoryRouter initialEntries={["/runs/run-1"]}>
            <AppShell />
          </MemoryRouter>
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  return { view, calls };
}

function stopRequests(calls: string[]) {
  return calls.filter((c) => c.includes("/stop"));
}

describe("Stop Run asks first, naming the branch", () => {
  it("offers Stop Run in the run actions menu, not as a bare toolbar button", () => {
    const { view } = renderRunPage();
    expect(view.container.querySelector("#btn-stop")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Run actions" }));
    expect(
      within(document.body).getByRole("menuitem", { name: "Stop Run" }),
    ).toBeTruthy();
  });

  it("asks in an alert that names the branch, and keeps the run when declined", async () => {
    const { view, calls } = renderRunPage();
    fireEvent.click(view.getByRole("button", { name: "Run actions" }));
    fireEvent.click(
      within(document.body).getByRole("menuitem", { name: "Stop Run" }),
    );

    const alert = within(document.body).getByRole("alertdialog");
    expect(alert.textContent).toContain("Stop run on factory/t-1-stop-me?");
    fireEvent.click(
      within(alert).getByRole("button", { name: "Keep Running" }),
    );

    await waitFor(() =>
      expect(within(document.body).queryByRole("alertdialog")).toBeNull(),
    );
    expect(stopRequests(calls)).toEqual([]);
  });

  it("stops the run only when the alert is confirmed", async () => {
    const { view, calls } = renderRunPage();
    fireEvent.click(view.getByRole("button", { name: "Run actions" }));
    fireEvent.click(
      within(document.body).getByRole("menuitem", { name: "Stop Run" }),
    );
    const alert = within(document.body).getByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Stop Run" }));

    await waitFor(() =>
      expect(stopRequests(calls)).toEqual(["POST /api/runs/run-1/stop"]),
    );
  });
});
