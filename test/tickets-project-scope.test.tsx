// test/tickets-project-scope.test.tsx — The shared project scope for Tickets
// and Runs (#260, spec #241). Behaviour only: what the user sees, picks and
// is told, never class names.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectScopePicker } from "../src/frontend/components/projects/ProjectScopePicker.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import {
  ALL_PROJECTS,
  PROJECT_SCOPE_STORAGE_KEY,
  readStoredProjectScope,
  resolveProjectScope,
} from "../src/frontend/lib/project-scope.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { ticketRunLinkOf } from "../src/frontend/lib/ticket-runs.js";
import { QueueView } from "../src/frontend/views/QueueView.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import type { Project, Run, RunStatus, Ticket } from "../src/shared/types.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  // Other suites can leave the browser "offline"; queries would then never fire.
  onlineManager.setOnline(true);
});

const ACME: Project = {
  id: "acme",
  name: "Acme Web",
  issueTracker: {
    provider: "azure",
    azure: { orgUrl: "https://dev.azure.com/org", project: "acme" },
  },
} as unknown as Project;

const DEMO: Project = {
  id: "demo-app",
  name: "Demo App",
  issueTracker: {
    provider: "azure",
    azure: { orgUrl: "https://dev.azure.com/org", project: "demo" },
  },
} as unknown as Project;

/** Queries over the document. Built per call: happy-dom registers after imports. */
function screen() {
  return within(document.body);
}

function ticket(id: string, title: string): Ticket {
  return { id, title, acceptanceCriteria: [] };
}

function run(id: string, project: Project, t: Ticket, status: RunStatus): Run {
  return {
    id,
    project: { id: project.id, name: project.name },
    ticket: t,
    plan: "",
    branch: `feat/${id}`,
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
    artifactsDir: "",
    worktreePath: "",
  } as Run;
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderWithScope(
  ui: React.ReactElement,
  client: QueryClient,
  route = "/tickets",
) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ModalProvider,
        null,
        React.createElement(
          MemoryRouter,
          { initialEntries: [route] },
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(ProjectScopePicker),
              React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: "/tickets", element: ui }),
                React.createElement(Route, { path: "/runs", element: ui }),
                React.createElement(Route, {
                  path: "/runs/:id",
                  element: React.createElement("p", null, "Run page"),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function seedProjects(client: QueryClient, projects: Project[] = [ACME, DEMO]) {
  client.setQueryData(queryKeys.projects(), projects);
}

/**
 * Replaces the tickets read per project: each project's tracker answers on its
 * own, so one failing project cannot touch another's list.
 */
function stubTrackers(answer: (projectId: string) => Promise<Ticket[]>) {
  const calls: string[] = [];
  const spy = spyOn(api, "getTickets").mockImplementation(
    (projectId: string) => {
      calls.push(projectId);
      return answer(projectId);
    },
  );
  return {
    calls,
    restore: () => spy.mockRestore(),
  };
}

function choose(value: string) {
  const select = screen().getByRole("combobox", { name: "Project" });
  act(() => {
    fireEvent.change(select, { target: { value } });
  });
}

describe("the remembered project scope (guarded storage)", () => {
  it("is All Projects on first launch, when nothing is remembered", () => {
    expect(readStoredProjectScope()).toBe(ALL_PROJECTS);
  });

  it("remembers the last choice in this browser", () => {
    const client = makeClient();
    seedProjects(client);
    renderWithScope(React.createElement("p", null, "tickets"), client);
    choose(DEMO.id);
    expect(window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)).toBe(
      DEMO.id,
    );
    expect(readStoredProjectScope()).toBe(DEMO.id);
  });

  it("falls back to All Projects when the remembered project no longer exists", () => {
    expect(resolveProjectScope("gone", [ACME, DEMO], true)).toBe(ALL_PROJECTS);
    expect(resolveProjectScope("gone", [], false)).toBe("gone");
  });

  it("keeps working when browser storage is blocked", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
    try {
      expect(readStoredProjectScope()).toBe(ALL_PROJECTS);
      const client = makeClient();
      seedProjects(client);
      renderWithScope(React.createElement("p", null, "tickets"), client);
      expect(screen().getByRole("combobox", { name: "Project" })).toBeDefined();
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
    }
  });
});

describe("the project picker", () => {
  it("offers All Projects and every project, with All Projects selected by default", () => {
    const client = makeClient();
    seedProjects(client);
    renderWithScope(React.createElement("p", null, "tickets"), client);
    const select = screen().getByRole("combobox", {
      name: "Project",
    }) as HTMLSelectElement;
    expect(select.value).toBe(ALL_PROJECTS);
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["All Projects", "Acme Web", "Demo App"]);
  });
});

describe("Tickets in All Projects mode", () => {
  it("lists each project's tickets under that project's own heading", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const acme = screen().getByRole("region", { name: "Acme Web" });
    expect(within(acme).getByText("Checkout copy")).toBeDefined();
    expect(within(acme).queryByText("Login banner")).toBeNull();
    const demo = screen().getByRole("region", { name: "Demo App" });
    expect(within(demo).getByText("Login banner")).toBeDefined();
  });

  it("loads and fails each project on its own, with Retry for the failed one", async () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    let demoAnswers = 0;
    const tracker = stubTrackers(() => {
      demoAnswers += 1;
      return Promise.reject(new Error("tracker unreachable"));
    });
    try {
      renderWithScope(React.createElement(QueueView), client);

      const demo = await screen().findByRole("region", { name: "Demo App" });
      await waitFor(() =>
        expect(within(demo).getByRole("alert")).toBeDefined(),
      );
      expect(within(demo).queryByText("tracker unreachable")).toBeNull();
      const acme = screen().getByRole("region", { name: "Acme Web" });
      expect(within(acme).getByText("Checkout copy")).toBeDefined();
      expect(within(acme).queryByRole("alert")).toBeNull();

      const before = demoAnswers;
      act(() => {
        fireEvent.click(
          within(demo).getByRole("button", { name: /try again/i }),
        );
      });
      await waitFor(() => expect(demoAnswers).toBeGreaterThan(before));
      expect(tracker.calls.every((id) => id === DEMO.id)).toBe(true);
    } finally {
      tracker.restore();
    }
  });

  it("shows a loading placeholder for a project whose tracker is still loading", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    const tracker = stubTrackers(() => new Promise<Ticket[]>(() => {}));
    try {
      renderWithScope(React.createElement(QueueView), client);

      const acme = screen().getByRole("region", { name: "Acme Web" });
      expect(within(acme).getAllByText("Loading…").length).toBeGreaterThan(0);
      const demo = screen().getByRole("region", { name: "Demo App" });
      expect(within(demo).getByText("Login banner")).toBeDefined();
    } finally {
      tracker.restore();
    }
  });

  it("follows the picker: a chosen project shows only its own tickets", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    choose(DEMO.id);
    expect(screen().getByText("Login banner")).toBeDefined();
    expect(screen().queryByText("Checkout copy")).toBeNull();
    expect(screen().queryByRole("region", { name: "Acme Web" })).toBeNull();
  });
});

describe("a ticket's run", () => {
  it("links to its active run instead of offering a second one", () => {
    const client = makeClient();
    seedProjects(client, [DEMO]);
    const t = ticket("DEMO-7", "Login banner");
    client.setQueryData(queryKeys.tickets(DEMO.id), [t]);
    client.setQueryData(queryKeys.runs(), [run("run-9", DEMO, t, "executing")]);
    renderWithScope(React.createElement(QueueView), client);

    const link = screen().getByRole("link", { name: "Open Run" });
    expect(link.getAttribute("href")).toBe("/runs/run-9");
    expect(screen().queryByRole("button", { name: "Start Run" })).toBeNull();
  });

  it("links to the most recently updated active run when a ticket has several", () => {
    const t = ticket("DEMO-7", "Login banner");
    const older = {
      ...run("run-old", DEMO, t, "planning"),
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const newer = {
      ...run("run-new", DEMO, t, "awaiting_plan_approval"),
      updatedAt: "2026-10-02T00:00:00.000Z",
    };
    const finished = run("run-done", DEMO, t, "pr_created");
    expect(ticketRunLinkOf([older, newer, finished], DEMO.id, t.id)).toEqual({
      kind: "active",
      runId: "run-new",
    });
    expect(ticketRunLinkOf([finished], DEMO.id, t.id)).toEqual({
      kind: "finished",
    });
    expect(ticketRunLinkOf([older], "other-project", t.id)).toEqual({
      kind: "none",
    });
  });

  it("offers Start Run for a ticket without a run", () => {
    const client = makeClient();
    seedProjects(client, [DEMO]);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    client.setQueryData(queryKeys.runs(), []);
    renderWithScope(React.createElement(QueueView), client);

    expect(screen().getByRole("button", { name: "Start Run" })).toBeDefined();
  });

  it("offers Start Run for a ticket whose only run has finished", () => {
    const client = makeClient();
    seedProjects(client, [DEMO]);
    const t = ticket("DEMO-7", "Login banner");
    client.setQueryData(queryKeys.tickets(DEMO.id), [t]);
    client.setQueryData(queryKeys.runs(), [
      run("run-3", DEMO, t, "pr_created"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    // One label for the row's action, always those two words (D1): a finished
    // run does not rename it, and the row is not a link to the old run.
    const action = screen().getByRole("button", { name: "Start Run" });
    expect(action).toBeDefined();
    expect(
      screen().queryByRole("button", { name: "Start New Run" }),
    ).toBeNull();
    expect(screen().queryByRole("link", { name: "Open Run" })).toBeNull();
    // A row accessory is never the region's one filled button (D1).
    expect(action.className).toContain("ui-button--secondary");
  });

  it("starts the run in the project the ticket belongs to, in All Projects mode", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    client.setQueryData(queryKeys.tickets(ACME.id), []);
    let prefill: unknown = null;
    function Probe() {
      prefill = useModal().newRunPrefill;
      return null;
    }
    render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          ModalProvider,
          null,
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(
              ProjectProvider,
              null,
              React.createElement(
                React.Fragment,
                null,
                React.createElement(QueueView),
                React.createElement(Probe),
              ),
            ),
          ),
        ),
      ),
    );
    const demoGroup = screen().getByRole("region", { name: "Demo App" });
    act(() => {
      fireEvent.click(
        within(demoGroup).getByRole("button", { name: "Start Run" }),
      );
    });
    expect(prefill).toMatchObject({ ticketId: "DEMO-7", projectId: DEMO.id });
  });
});

describe("no projects", () => {
  it("points Tickets to Add Project", () => {
    const client = makeClient();
    seedProjects(client, []);
    renderWithScope(React.createElement(QueueView), client);
    expect(
      screen().getByText("Add a project to see its tickets."),
    ).toBeDefined();
    expect(screen().getByRole("button", { name: "Add Project" })).toBeDefined();
  });
});

describe("Runs follows the same scope", () => {
  it("counts and lists only the chosen project's runs", () => {
    const client = makeClient();
    seedProjects(client);
    const a = ticket("ACME-1", "Checkout copy");
    const d = ticket("DEMO-7", "Login banner");
    client.setQueryData(queryKeys.runs(), [
      run("run-a", ACME, a, "executing"),
      run("run-d", DEMO, d, "executing"),
    ]);
    renderWithScope(React.createElement(RunsView), client, "/runs");

    expect(
      screen().getByRole("radio", { name: /^Running\s*2$/ }),
    ).toBeDefined();
    expect(screen().getByText("Checkout copy")).toBeDefined();

    choose(DEMO.id);
    // The filter counts follow the scope at once; the row list is covered by
    // the same filter, so the other project's run no longer counts here.
    expect(
      screen().getByRole("radio", { name: /^Running\s*1$/ }),
    ).toBeDefined();
    expect(screen().getByRole("radio", { name: /^All\s*1$/ })).toBeDefined();
    expect(screen().getByText("Login banner")).toBeDefined();
  });
});

describe("the Tickets toolbar", () => {
  it("filters every project's tickets by what is typed", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const filter = screen().getByRole("textbox", { name: "Filter tickets" });
    act(() => {
      filter.focus();
      fireEvent.change(filter, { target: { value: "login" } });
      fireEvent.keyUp(filter);
    });
    expect(screen().getByText("Login banner")).toBeDefined();
    expect(screen().queryByText("Checkout copy")).toBeNull();
    expect(
      within(screen().getByRole("region", { name: "Acme Web" })).getByText(
        /No tickets matched/,
      ),
    ).toBeDefined();
  });

  it("Refresh tickets asks every visible project's tracker again", async () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), [
      ticket("DEMO-7", "Login banner"),
    ]);
    const tracker = stubTrackers(() => Promise.resolve([]));
    try {
      renderWithScope(React.createElement(QueueView), client);
      act(() => {
        fireEvent.click(
          screen().getByRole("button", { name: "Refresh tickets" }),
        );
      });
      await waitFor(() =>
        expect(tracker.calls.sort()).toEqual([ACME.id, DEMO.id].sort()),
      );
    } finally {
      tracker.restore();
    }
  });
});

describe("hand-written tickets in the Tickets list", () => {
  it("lists a ticket that has a run but is not in the tracker, marked as written by hand", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), []);
    client.setQueryData(queryKeys.runs(), [
      run("run-hand", ACME, ticket("HAND-1", "Hand written task"), "executing"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const acme = screen().getByRole("region", { name: "Acme Web" });
    expect(within(acme).getByText("Hand written task")).toBeDefined();
    const card = within(acme).getByRole("button", {
      name: "Select ticket HAND-1: Hand written task",
    });
    expect(card.textContent).toContain("Written by hand");
    // The tracker's own ticket is not marked.
    const tracked = within(acme).getByRole("button", {
      name: "Select ticket ACME-1: Checkout copy",
    });
    expect(tracked.textContent).not.toContain("Written by hand");
  });

  it("does not repeat a tracker ticket that also has a run", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("ACME-1", "Checkout copy"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), []);
    client.setQueryData(queryKeys.runs(), [
      run("run-tracked", ACME, ticket("ACME-1", "Checkout copy"), "executing"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const acme = screen().getByRole("region", { name: "Acme Web" });
    expect(
      within(acme).getAllByRole("button", { name: /Select ticket ACME-1/ }),
    ).toHaveLength(1);
    expect(acme.textContent).not.toContain("Written by hand");
  });

  it("shows a hand-written ticket once, under the project its runs belong to", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), []);
    client.setQueryData(queryKeys.tickets(DEMO.id), []);
    client.setQueryData(queryKeys.runs(), [
      run("run-1", ACME, ticket("HAND-1", "Hand written task"), "failed"),
      run("run-2", ACME, ticket("HAND-1", "Hand written task"), "executing"),
      run("run-3", DEMO, ticket("DEMO-9", "Demo only"), "executing"),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const acme = screen().getByRole("region", { name: "Acme Web" });
    expect(
      within(acme).getAllByRole("button", { name: /Select ticket HAND-1/ }),
    ).toHaveLength(1);
    expect(within(acme).queryByText("Demo only")).toBeNull();
    const demo = screen().getByRole("region", { name: "Demo App" });
    expect(within(demo).getByText("Demo only")).toBeDefined();
    expect(within(demo).queryByText("Hand written task")).toBeNull();
  });

  it("does not mark a tracker ticket whose id the server stored with a different character", () => {
    const client = makeClient();
    seedProjects(client);
    client.setQueryData(queryKeys.tickets(ACME.id), [
      ticket("AB#1234", "Tracker ticket with a hash id"),
    ]);
    client.setQueryData(queryKeys.tickets(DEMO.id), []);
    // createRun stores the id with the `#` replaced by `-`.
    client.setQueryData(queryKeys.runs(), [
      run(
        "run-ab",
        ACME,
        ticket("AB-1234", "Tracker ticket with a hash id"),
        "executing",
      ),
    ]);
    renderWithScope(React.createElement(QueueView), client);

    const acme = screen().getByRole("region", { name: "Acme Web" });
    expect(
      within(acme).getAllByRole("button", {
        name: /Tracker ticket with a hash/,
      }),
    ).toHaveLength(1);
    expect(acme.textContent).not.toContain("Written by hand");
  });
});
