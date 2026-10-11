// The Runs list screen (#259): filter segments with counts, the default
// choice, row content, live patches from the app-wide stream, and the Runs
// badge and tab title. Behaviour only: roles, names, text and outcomes.

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { subscribeAppEvents } from "../src/frontend/lib/app-events.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import type {
  AppEventEnvelope,
  Project,
  Run,
  RunStatus,
} from "../src/shared/types.js";

const realFetch = globalThis.fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  try {
    window.localStorage.removeItem("runs-list-filter");
  } catch {
    // storage unavailable: nothing to clean
  }
});

function run(id: string, status: RunStatus, title = `Ticket ${id}`): Run {
  return {
    id,
    project: { id: "demo", name: "Demo App" },
    ticket: { id: `T-${id}`, title, acceptanceCriteria: [] },
    plan: "",
    branch: `feat/${id}`,
    status,
    startedAt: "2026-10-11T10:00:00.000Z",
    finishedAt: null,
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  } as unknown as Run;
}

const PROJECT = { id: "demo", name: "Demo App" } as Project;

function makeClient(runs: Run[]) {
  // Any request the screen makes after this point is a refetch: none may happen
  // for a live update, so the stub counts them.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.runs(), runs);
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return client;
}

function renderRuns(client: QueryClient, url = "/runs") {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <RunsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function segment(view: ReturnType<typeof render>, name: RegExp) {
  return view.getByRole("radio", { name });
}

function isChecked(radio: HTMLElement): boolean {
  return (radio as HTMLInputElement).checked;
}

function rowTitles(view: ReturnType<typeof render>): string[] {
  return view.queryAllByRole("link").map((link) => link.textContent ?? "");
}

describe("Runs filter segments", () => {
  it("shows Needs you, Running, Done and All, each with its count", () => {
    const view = renderRuns(
      makeClient([
        run("a", "awaiting_plan_approval"),
        run("b", "executing"),
        run("c", "pr_created"),
      ]),
    );
    expect(isChecked(segment(view, /^Needs you\s*1$/))).toBe(true);
    expect(segment(view, /^Running\s*1$/)).toBeTruthy();
    expect(segment(view, /^Done\s*1$/)).toBeTruthy();
    expect(segment(view, /^All\s*3$/)).toBeTruthy();
  });

  it("defaults to Needs you when a run waits for the user", () => {
    const view = renderRuns(
      makeClient([run("a", "awaiting_plan_approval"), run("b", "executing")]),
    );
    expect(rowTitles(view).join("|")).toContain("Ticket a");
    expect(rowTitles(view).join("|")).not.toContain("Ticket b");
  });

  it("keeps the last filter the user chose when nothing waits", () => {
    const client = makeClient([run("c", "pr_created"), run("b", "executing")]);
    const first = renderRuns(client);
    fireEvent.click(segment(first, /^Done/));
    expect(rowTitles(first).join("|")).toContain("Ticket c");
    cleanup();

    const again = renderRuns(client);
    expect(isChecked(segment(again, /^Done/))).toBe(true);
    expect(rowTitles(again).join("|")).toContain("Ticket c");
  });

  it("lists every run under All", () => {
    const view = renderRuns(
      makeClient([run("a", "awaiting_plan_approval"), run("b", "executing")]),
      "/runs?filter=all",
    );
    expect(rowTitles(view)).toHaveLength(2);
  });
});

describe("Runs rows", () => {
  it("show the ticket key, title, project, plain status and relative time", () => {
    const view = renderRuns(
      makeClient([run("a", "awaiting_plan_approval", "Add login")]),
    );
    const row = view.getByRole("link", { name: /T-a/ });
    expect(row.textContent).toContain("T-a");
    expect(row.textContent).toContain("Add login");
    expect(row.textContent).toContain("Demo App");
    expect(row.textContent).toContain("Review the plan");
    expect(row.textContent).toContain("minutes ago");
  });
});

describe("Live updates from the app-wide stream", () => {
  it("moves a row to its new filter without refetching the list", async () => {
    const client = makeClient([run("b", "executing")]);
    const view = renderRuns(client, "/runs?filter=running");
    expect(rowTitles(view).join("|")).toContain("Ticket b");

    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    let onMessage: ((data: string) => void) | undefined;
    const stop = subscribeAppEvents({
      queryClient: client,
      initialCursor: 0,
      transport: (_cursor, handlers) => {
        onMessage = handlers.onMessage;
        return () => {};
      },
    });
    const envelope: AppEventEnvelope = {
      id: 1,
      runId: "b",
      sequence: 2,
      type: "status",
      payload: { status: "awaiting_review", text: "Changes ready" },
      time: new Date().toISOString(),
      ticket: run("b", "executing").ticket,
      project: { id: "demo", name: "Demo App" },
    } as AppEventEnvelope;
    act(() => onMessage?.(JSON.stringify(envelope)));
    stop();

    await waitFor(() =>
      expect(rowTitles(view).join("|")).not.toContain("Ticket b"),
    );
    expect(fetches).toBe(0);
    fireEvent.click(segment(view, /^Needs you/));
    expect(rowTitles(view).join("|")).toContain("Ticket b");
  });
});

describe("Runs badge and tab title (#259)", () => {
  function renderShell(client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <ProjectProvider>
          <ModalProvider>
            <MemoryRouter initialEntries={["/tickets"]}>
              <AppShell />
            </MemoryRouter>
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    );
  }

  it("counts Needs-you runs on the Runs section and in the tab title", async () => {
    const view = renderShell(
      makeClient([
        run("a", "awaiting_plan_approval"),
        run("d", "recovery_required"),
        run("b", "executing"),
        run("c", "pr_created"),
      ]),
    );
    await waitFor(() =>
      expect(view.getByRole("radio", { name: /^Runs\s*2$/ })).toBeTruthy(),
    );
    expect(document.title).toBe("(2) X-Factory");
  });

  it("shows no count and the plain title when nothing waits", async () => {
    const view = renderShell(makeClient([run("b", "executing")]));
    await waitFor(() =>
      expect(view.getByRole("radio", { name: /^Runs$/ })).toBeTruthy(),
    );
    expect(document.title).toBe("X-Factory");
  });
});

beforeEach(() => {
  document.title = "X-Factory";
});
