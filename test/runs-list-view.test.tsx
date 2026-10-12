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
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
      <ProjectProvider>
        <MemoryRouter initialEntries={[url]}>
          <RunsView />
        </MemoryRouter>
      </ProjectProvider>
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

  it("defaults to Needs you when the waiting run is in another project than the scope", () => {
    window.localStorage.setItem("xf_selected_project", "other");
    const mine = {
      ...run("m", "executing"),
      project: { id: "other", name: "Other" },
    } as Run;
    const view = renderRuns(
      makeClient([run("a", "awaiting_plan_approval"), mine]),
    );
    window.localStorage.removeItem("xf_selected_project");
    expect(isChecked(segment(view, /^Needs you/))).toBe(true);
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
    expect(row.textContent).toContain("5 min ago");
    const time = row.querySelector("time");
    expect(time?.getAttribute("title")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("lead with the ticket title as a heading and show the status as a toned badge", () => {
    const view = renderRuns(
      makeClient([
        run("a", "awaiting_plan_approval", "Add login"),
        run("b", "executing", "Add logout"),
        run("f", "failed", "Add signup"),
      ]),
      "/runs?filter=all",
    );
    const row = view.getByRole("link", { name: /T-a/ });
    expect(
      within(row).getByRole("heading", { name: "Add login" }).className,
    ).toContain("run-card-title");
    const badgeOf = (key: RegExp) =>
      view.getByRole("link", { name: key }).querySelector(".ui-badge");
    expect(badgeOf(/T-a/)?.textContent).toBe("Review the plan");
    expect(badgeOf(/T-a/)?.className).toContain("ui-badge--warning");
    expect(badgeOf(/T-b/)?.className).toContain("ui-badge--accent");
    expect(badgeOf(/T-f/)?.className).toContain("ui-badge--error");
  });

  it("keep the title in the case it was written, not the card's small caps heading", () => {
    const css = readFileSync(
      path.join(import.meta.dir, "../src/frontend/views/RunsView.css"),
      "utf8",
    );
    const match = /([^{}]*\.run-card-title)\s*\{([^}]*)\}/.exec(css);
    const selector = match?.[1]?.trim() ?? "";
    const rule = match?.[2] ?? "";
    // It must out-rank the shared `.card h3` (one class, one element).
    expect((selector.match(/\.[\w-]+/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(rule).toMatch(/text-transform:\s*none/);
    expect(rule).toMatch(/letter-spacing:\s*normal/);
    expect(rule).toMatch(/color:\s*var\(--text\)/);
  });

  it("shows Merged and Closed without merging badges when pullRequestOutcome is present", () => {
    const mergedRun = {
      ...run("m", "pr_created", "Merged ticket"),
      pullRequestOutcome: {
        status: "merged" as const,
        url: "https://github.com/o/r/pull/1",
        mergedAt: "2026-10-11T10:00:00.000Z",
      },
    };
    const closedRun = {
      ...run("c", "pr_created", "Closed ticket"),
      pullRequestOutcome: {
        status: "closed" as const,
        url: "https://github.com/o/r/pull/2",
        closedAt: "2026-10-11T10:00:00.000Z",
      },
    };
    const view = renderRuns(
      makeClient([mergedRun, closedRun]),
      "/runs?filter=done",
    );
    const mergedRow = view.getByRole("link", { name: /T-m/ });
    expect(mergedRow.textContent).toContain("Merged");

    const closedRow = view.getByRole("link", { name: /T-c/ });
    expect(closedRow.textContent).toContain("Closed without merging");
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
  it("adds a run created elsewhere by fetching that one run, not the list", async () => {
    const client = makeClient([run("b", "executing")]);
    const view = renderRuns(client, "/runs?filter=all");
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(run("n", "awaiting_plan_approval")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
    const envelope = {
      id: 7,
      runId: "n",
      sequence: 1,
      type: "status",
      payload: { status: "awaiting_plan_approval", text: "Plan ready" },
      time: new Date().toISOString(),
      ticket: run("n", "executing").ticket,
      project: { id: "demo", name: "Demo App" },
    } as AppEventEnvelope;
    act(() => onMessage?.(JSON.stringify(envelope)));
    stop();

    await waitFor(() =>
      expect(rowTitles(view).join("|")).toContain("Ticket n"),
    );
    expect(urls).toEqual(["/api/runs/n"]);
    expect(segment(view, /^All\s*2$/)).toBeTruthy();
  });

  it("updates a row with Merged badge when pr_merged event arrives", async () => {
    const prRun = run("c", "pr_created", "PR ticket");
    const client = makeClient([prRun]);
    const view = renderRuns(client, "/runs?filter=done");
    expect(rowTitles(view).join("|")).toContain("PR ticket");

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
      id: 5,
      runId: "c",
      sequence: 10,
      type: "pr_merged",
      payload: {
        url: "https://github.com/o/r/pull/1",
        mergedAt: new Date().toISOString(),
      },
      time: new Date().toISOString(),
      ticket: prRun.ticket,
      project: PROJECT,
    } as unknown as AppEventEnvelope;

    act(() => onMessage?.(JSON.stringify(envelope)));
    stop();

    await waitFor(() => {
      const row = view.getByRole("link", { name: /T-c/ });
      expect(row.textContent).toContain("Merged");
    });
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
