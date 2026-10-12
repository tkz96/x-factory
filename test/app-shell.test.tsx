// test/app-shell.test.tsx — The app shell as a user sees it (#258, spec #241).
// Behaviour: what the toolbar offers, how the sections switch, what a scroll
// does to the title, where the old routes land, where Help is reachable and that
// every screen has exactly one heading level 1.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { WELCOME_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { routeDefinitions } from "../src/frontend/routes.js";
import { shortcutLabel } from "../src/frontend/shortcuts/registry.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";
import type { Project, Run } from "../src/shared/types.js";

afterAll(async () => {
  await unregisterHappyDom();
});

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const PROJECT: Project = {
  id: "demo-app",
  name: "Demo App",
} as Project;

function run(id: string, status: Run["status"]): Run {
  return {
    id,
    project: { id: PROJECT.id, name: PROJECT.name },
    ticket: { id: `T-${id}`, title: `Ticket ${id}`, acceptanceCriteria: [] },
    plan: "",
    branch: `feat/${id}`,
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
  } as unknown as Run;
}

/** Every query answers an empty list, so the shell renders without a server. */
function stubFetch() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function newClient(seed: (client: QueryClient) => void = () => {}) {
  stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  client.setQueryData(queryKeys.runs(), []);
  seed(client);
  return client;
}

function renderShell(path: string, client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppShell />
          </MemoryRouter>
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

function renderRoutes(path: string) {
  const client = newClient();
  const router = createMemoryRouter(routeDefinitions, {
    initialEntries: [path],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  return { view, router };
}

describe("App shell toolbar (#258)", () => {
  it("has no sidebar and no global New Run button on a workbench screen", () => {
    const view = renderShell("/tickets");
    expect(view.queryByRole("complementary")).toBeNull();
    expect(view.queryByRole("button", { name: "New Run" })).toBeNull();
    expect(view.queryByRole("link", { name: "New Run" })).toBeNull();
  });

  it("shows the registry shortcut in the Start Run tooltip, in the page heading", () => {
    const view = renderShell("/tickets");
    const slot = view.container.querySelector(".page-heading-actions");
    expect(slot).not.toBeNull();
    const button = within(slot as HTMLElement).getByRole("button", {
      name: "Start Run",
    });
    expect(button.getAttribute("title")).toBe(
      `Start Run (${shortcutLabel("newRun")})`,
    );
  });

  it("offers Start Run in the page heading on Tickets and Add Project on Projects, and neither in the toolbar", () => {
    const tickets = renderShell("/tickets");
    const ticketsSlot = tickets.container.querySelector(".page-heading-actions");
    expect(ticketsSlot).not.toBeNull();
    expect(
      within(ticketsSlot as HTMLElement).getByRole("button", {
        name: "Start Run",
      }),
    ).toBeTruthy();
    // The toolbar carries search, the bell and Settings — never a page action.
    expect(
      within(tickets.getByRole("banner")).queryByRole("button", {
        name: "Start Run",
      }),
    ).toBeNull();
    expect(
      within(tickets.getByRole("banner")).queryByRole("button", {
        name: "Add Project",
      }),
    ).toBeNull();
    cleanup();

    const projects = renderShell("/projects");
    const projectsSlot =
      projects.container.querySelector(".page-heading-actions");
    expect(projectsSlot).not.toBeNull();
    expect(
      within(projectsSlot as HTMLElement).getByRole("button", {
        name: "Add Project",
      }),
    ).toBeTruthy();
    expect(
      within(projects.getByRole("banner")).queryByRole("button", {
        name: "Add Project",
      }),
    ).toBeNull();
    expect(
      within(projects.getByRole("banner")).queryByRole("button", {
        name: "Start Run",
      }),
    ).toBeNull();
  });

  it("switches between Tickets, Runs and Projects from the segmented control", () => {
    const view = renderShell("/tickets");
    const sections = view.getByRole("radiogroup", { name: "Sections" });
    expect(
      (
        within(sections).getByRole("radio", {
          name: "Tickets",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(within(sections).getByRole("radio", { name: "Runs" }));
    expect(
      (
        within(sections).getByRole("radio", {
          name: "Runs",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(view.getByRole("heading", { level: 1, name: "Runs" })).toBeTruthy();
  });

  it("opens Settings from the gear, and Settings is the only gear destination", () => {
    const view = renderShell("/tickets");
    const gear = view.getByRole("link", { name: "Settings" });
    expect(gear.getAttribute("href")).toBe("/settings");
  });

  it("keeps the theme toggle out of the toolbar: appearance lives in Settings and the palette", async () => {
    const view = renderShell("/tickets");
    const banner = view.getByRole("banner");
    // The toolbar has no appearance control of its own any more (SYS-10), and no
    // status readout: nothing when the workbench is ready.
    expect(
      within(banner).queryByRole("button", { name: /Switch to .* Appearance/ }),
    ).toBeNull();
    expect(view.container.querySelector(".status-label")).toBeNull();

    // The palette is where it went, and choosing it flips the appearance.
    const before = document.documentElement.getAttribute("data-appearance");
    fireEvent.click(within(banner).getByRole("button", { name: "Search" }));
    const palette = view.getByRole("dialog", { name: "Command palette" });
    fireEvent.click(
      within(palette).getByRole("option", { name: /Toggle Appearance/ }),
    );
    await waitFor(() =>
      expect(
        document.documentElement.getAttribute("data-appearance"),
      ).not.toBe(before),
    );
  });

  it("gives phone width a bottom tab bar with Tickets, Runs and Projects only", () => {
    const view = renderShell("/tickets");
    const tabs = view.getByRole("navigation", { name: "Mobile Navigation" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Tickets",
      "Runs",
      "Projects",
    ]);
  });
});

describe("Docs keeps its own document list (#258)", () => {
  it("returns to Tickets from the document list's back link", () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ categories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const view = renderShell("/docs", newClient());
    const back = view.getByRole("link", { name: "Back to Tickets" });
    expect(back.getAttribute("href")).toBe("/tickets");
    expect(view.queryByRole("link", { name: "New Run" })).toBeNull();
  });
});

describe("Large titles shrink into the toolbar (#258)", () => {
  it("renders no title in the toolbar until the screen has scrolled (SYS-12)", () => {
    const view = renderShell("/tickets");
    const banner = view.getByRole("banner");
    const toolbarTitle = () => banner.querySelector(".toolbar-title");
    // The span is not rendered at all until it has something to say: the bar
    // never holds an empty title.
    expect(toolbarTitle()).toBeNull();

    const main = document.getElementById("app-main") as HTMLElement;
    Object.defineProperty(main, "scrollTop", {
      value: 240,
      configurable: true,
    });
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()?.textContent).toBe("Tickets");

    Object.defineProperty(main, "scrollTop", { value: 0, configurable: true });
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()).toBeNull();
  });
});

describe("The welcome is a full-window screen (#269)", () => {
  it("renders without the toolbar and the tab bar, and its step links still work", async () => {
    const { view } = renderRoutes("/welcome");

    await waitFor(() =>
      expect(
        view.getByRole("link", { name: WELCOME_COPY.stepAction.model }),
      ).toBeTruthy(),
    );
    // Nothing frames a screen whose own work is not set up yet: no toolbar and
    // no tab bar.
    expect(view.queryByRole("banner")).toBeNull();
    expect(
      view.queryByRole("navigation", { name: "Mobile Navigation" }),
    ).toBeNull();
    // The screen keeps the title the toolbar would otherwise carry.
    expect(
      view.getByRole("heading", { level: 1, name: WELCOME_COPY.title }),
    ).toBeTruthy();

    // Its links are how the user leaves the welcome, and they still work.
    expect(
      view
        .getByRole("link", { name: WELCOME_COPY.stepAction.model })
        .getAttribute("href"),
    ).toBe(WELCOME_COPY.stepPath.model);
    expect(
      view
        .getByRole("link", { name: WELCOME_COPY.stepAction.run })
        .getAttribute("href"),
    ).toBe(WELCOME_COPY.stepPath.run);
  });
});

describe("Old routes redirect to their new equivalents (#258)", () => {
  it("sends /queue to Tickets", async () => {
    const { router } = renderRoutes("/queue");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tickets"),
    );
  });

  it("sends /history to the Done filter of Runs", async () => {
    const { router } = renderRoutes("/history");
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs"));
    expect(router.state.location.search).toBe("?filter=done");
  });
});

describe("Runs filter (#258)", () => {
  it("lists finished runs under ?filter=done and active runs otherwise", () => {
    const client = newClient((c) => {
      c.setQueryData(queryKeys.runs(), [
        run("active-1", "executing"),
        run("finished-1", "pr_created"),
      ]);
    });
    const active = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/runs"]}>
          <ProjectProvider>
            <RunsView />
          </ProjectProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(active.queryByText(/Ticket finished-1/)).toBeNull();
    expect(active.getByText(/Ticket active-1/)).toBeTruthy();
    cleanup();

    const done = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/runs?filter=done"]}>
          <ProjectProvider>
            <RunsView />
          </ProjectProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(done.queryByText(/Ticket active-1/)).toBeNull();
    expect(done.getByText(/Ticket finished-1/)).toBeTruthy();
  });
});

describe("Help is reachable from Settings (#258)", () => {
  it("links to Documentation and the API Reference", () => {
    const view = render(
      <QueryClientProvider client={newClient()}>
        <ProjectProvider>
          <ModalProvider>
            <MemoryRouter initialEntries={["/settings"]}>
              <SettingsView />
            </MemoryRouter>
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    );
    // Help is its own category in the Settings list (#266).
    fireEvent.click(view.getByRole("link", { name: "Help" }));
    const docs = view.getByRole("link", { name: "Documentation" });
    expect(docs.getAttribute("href")).toBe("/docs");
    const reference = view.getByRole("link", { name: "API Reference" });
    expect(reference.getAttribute("href")).toBe("/reference");
  });
});

describe("One heading level 1 per screen (#258)", () => {
  for (const path of ["/tickets", "/runs", "/projects", "/settings"]) {
    it(`${path} has exactly one h1`, async () => {
      const view = renderShell(path);
      await waitFor(() => view.getByRole("banner"));
      expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });
  }

  it("a run page has exactly one h1, in the toolbar", () => {
    const view = renderShell("/runs/run-1");
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
