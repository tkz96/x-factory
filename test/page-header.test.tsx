// test/page-header.test.tsx — The PageHeader slot (#298, spec #292).
// Behaviour: a view claims the shell's page heading through usePageHeader —
// the shell renders the claimed title and actions in the page heading and in
// the compact toolbar title, at desktop and phone width alike — the shell's
// own heading stands when the view brings none or unmounts, and the hook is a
// no-op when a view renders without a shell.

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
import { type ReactNode, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { Button } from "../src/frontend/components/ui/Button.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import {
  type PageHeaderContent,
  usePageHeader,
} from "../src/frontend/context/PageHeaderContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type { Project } from "../src/shared/types.js";

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

/** Every query answers an empty list, so the shell renders without a server. */
function stubFetch() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

/** A stand-in view that claims the shell's heading while it is mounted. */
function FixtureView({
  claim,
  children,
}: {
  claim: PageHeaderContent;
  children?: ReactNode;
}) {
  usePageHeader(claim);
  return <div className="fixture-view">{children}</div>;
}

/** A view whose title arrives after mount, the way data names a detail page. */
function LateTitleView() {
  const [title, setTitle] = useState("Loading Screen");
  usePageHeader({ title });
  return (
    <Button id="btn-load-title" onPress={() => setTitle("Loaded Screen")}>
      Load title
    </Button>
  );
}

const routes = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        path: "slot-full",
        element: (
          <FixtureView
            claim={{
              title: "Fixture Screen",
              subtitle: "From the view",
              actions: (
                <Button id="btn-fixture" onPress={() => {}}>
                  Do Thing
                </Button>
              ),
            }}
          />
        ),
      },
      {
        path: "slot-late-title",
        element: <LateTitleView />,
      },
      {
        // On a section address the shell keeps its own page action (Start
        // Run) until the view brings actions of its own.
        path: "tickets/slot-title-only",
        element: <FixtureView claim={{ title: "Tickets Reclaimed" }} />,
      },
      {
        // actions: null says the screen has none, so the shell's Start Run
        // must not stand in for it.
        path: "tickets/slot-no-actions",
        element: (
          <FixtureView claim={{ title: "No Actions Here", actions: null }} />
        ),
      },
      {
        path: "slot-navigate",
        element: <FixtureView claim={{ title: "Slot Navigator" }} />,
      },
      {
        // The claim's destination: a screen that never touches the slot.
        path: "tickets",
        element: <div>Tickets body</div>,
      },
    ],
  },
];

function renderSlot(path: string) {
  stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  client.setQueryData(queryKeys.runs(), []);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
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

function pageTitle(view: { container: HTMLElement }): HTMLElement {
  const heading = view.container.querySelector("#page-title");
  expect(heading).not.toBeNull();
  return heading as HTMLElement;
}

describe("The page header slot (#298)", () => {
  it("renders the view's title and subtitle as the screen's one h1", async () => {
    const { view } = renderSlot("/slot-full");
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Fixture Screen"),
    );
    expect(view.container.querySelector(".page-subtitle")?.textContent).toBe(
      "From the view",
    );
    // The slot is the shell's single heading; the view rendered no header.
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the view's action in the heading's action slot, never in the toolbar", async () => {
    const { view } = renderSlot("/slot-full");
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Fixture Screen"),
    );
    const heading = view.container.querySelector(
      ".page-heading",
    ) as HTMLElement;
    expect(
      within(heading).getByRole("button", { name: "Do Thing" }),
    ).toBeTruthy();
    // The toolbar carries the app's controls, never the screen's own action
    // (DESIGN.md §7) — the claim reaches the heading only.
    expect(
      within(view.getByRole("banner")).queryByRole("button", {
        name: "Do Thing",
      }),
    ).toBeNull();
  });

  it("keeps the shell's section action when the view brings none, and drops it when the view says there are none", async () => {
    const kept = renderSlot("/tickets/slot-title-only");
    await waitFor(() =>
      expect(pageTitle(kept.view).textContent).toBe("Tickets Reclaimed"),
    );
    const keptHeading = kept.view.container.querySelector(
      ".page-heading",
    ) as HTMLElement;
    expect(
      within(keptHeading).getByRole("button", { name: "Start Run…" }),
    ).toBeTruthy();
    cleanup();

    const dropped = renderSlot("/tickets/slot-no-actions");
    await waitFor(() =>
      expect(pageTitle(dropped.view).textContent).toBe("No Actions Here"),
    );
    const droppedHeading = dropped.view.container.querySelector(
      ".page-heading",
    ) as HTMLElement;
    expect(
      within(droppedHeading).queryByRole("button", { name: "Start Run…" }),
    ).toBeNull();
  });

  it("re-claims as the view's title changes after mount", async () => {
    const { view } = renderSlot("/slot-late-title");
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Loading Screen"),
    );
    fireEvent.click(view.getByRole("button", { name: "Load title" }));
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Loaded Screen"),
    );
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("carries the claimed title into the toolbar on scroll, on desktop and at phone width", async () => {
    const { view } = renderSlot("/slot-full");
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Fixture Screen"),
    );
    const banner = view.getByRole("banner");
    const toolbarTitle = () => banner.querySelector(".toolbar-title");

    // The heading itself is a direct child of the viewport at every width —
    // nothing in the markup gates it to a breakpoint; only CSS collapses an
    // action's label on a phone (shared/controls.css, Page header section).
    expect(
      view.container.querySelector(
        "#viewport-container > .page-heading #page-title",
      ),
    ).not.toBeNull();
    expect(toolbarTitle()).toBeNull();

    // Desktop: <main> is the scrolling element.
    const main = document.getElementById("app-main") as HTMLElement;
    Object.defineProperty(main, "scrollTop", {
      value: 240,
      configurable: true,
    });
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()?.textContent).toBe("Fixture Screen");

    Object.defineProperty(main, "scrollTop", { value: 0, configurable: true });
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()).toBeNull();

    // Phone width: the window scrolls instead of <main>.
    Object.defineProperty(window, "scrollY", {
      value: 240,
      configurable: true,
    });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()?.textContent).toBe("Fixture Screen");

    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(toolbarTitle()).toBeNull();
  });

  it("releases the claim when the view unmounts, so the shell's own heading stands again", async () => {
    const { view, router } = renderSlot("/slot-navigate");
    await waitFor(() =>
      expect(pageTitle(view).textContent).toBe("Slot Navigator"),
    );

    await act(async () => {
      await router.navigate("/tickets");
    });
    // The stale view's cleanup must not leave its title behind, nor hide the
    // heading the next screen owns.
    await waitFor(() => expect(pageTitle(view).textContent).toBe("Tickets"));
    expect(view.queryByText("Slot Navigator")).toBeNull();
    expect(view.getByText("Tickets body")).toBeTruthy();
  });

  it("is a no-op when a view renders without a shell", () => {
    function StandaloneView() {
      usePageHeader({ title: "Claimed Nowhere" });
      return <div>Standalone body</div>;
    }
    const view = render(<StandaloneView />);
    expect(view.getByText("Standalone body")).toBeTruthy();
    expect(view.container.querySelector("#page-title")).toBeNull();
  });
});
