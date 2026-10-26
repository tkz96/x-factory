// test/queue-blocks.test.tsx — The Tickets area on the blocks (spec #292, M2).
//
// The migration replaced markup in this screen: the ticket row's surface is
// the Card block, the toolbar's glyphs come through the Icon block, the empty
// list is the EmptyState block AsyncRegion renders, and the screen claims the
// shell's page heading through usePageHeader instead of rendering a heading
// of its own. These tests pin each block where the old markup used to be.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QUEUE_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { TicketSearchToolbar } from "../src/frontend/components/queue/TicketSearchToolbar.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import {
  PageHeaderProvider,
  usePageHeaderContent,
} from "../src/frontend/context/PageHeaderContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { QueueView } from "../src/frontend/views/QueueView.js";
import type { Project, Ticket } from "../src/shared/types.js";

const MANIFEST: ProviderDescriptor[] = [
  {
    id: "tracker-one",
    displayName: "Tracker One",
    roles: ["tracker"],
    iconRef: "icon-tracker-one",
    capabilities: ["listTickets"],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
    ],
  },
];

/** One tracker connection that requires the label `x-factory`. */
const PROJECT = {
  id: "proj-1",
  name: "Rocket",
  issueTracker: { provider: "tracker-one" },
  connections: [
    {
      providerId: "tracker-one",
      roles: ["tracker"],
      config: {
        host: "https://tracker.example",
        requiredLabel: "x-factory",
      },
    },
  ],
} as unknown as Project;

function ticket(id: string): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    acceptanceCriteria: [],
    provider: "github",
  };
}

/** Reads what the mounted view claimed for the shell's page heading. */
function HeadingProbe() {
  const content = usePageHeaderContent();
  return <div data-testid="claimed-heading">{content?.title ?? "(none)"}</div>;
}

function renderQueue(tickets: Ticket[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.providers(), MANIFEST);
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  client.setQueryData(queryKeys.tickets(PROJECT.id), tickets);
  api.getTickets = mock(async () => tickets) as never;
  return render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <PageHeaderProvider>
            <MemoryRouter initialEntries={["/tickets"]}>
              <HeadingProbe />
              <QueueView />
            </MemoryRouter>
          </PageHeaderProvider>
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.providers.getManifest = mock(async () => MANIFEST);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterAll(async () => {
  await unregisterHappyDom();
});

describe("the Tickets area on the blocks (M2)", () => {
  it("draws a ticket row with the Card block and keeps the press target on the row", async () => {
    const { container } = renderQueue([ticket("GH-7")]);

    await waitFor(() => {
      if (container.querySelectorAll(".ui-card--ticket").length === 0) {
        throw new Error("ticket rows missing");
      }
    });

    const card = container.querySelector(".ui-card--ticket");
    // The block's two classes stand where `.ticket-card` used to.
    expect(card?.classList.contains("ui-card")).toBe(true);
    // The press target wraps the card: role, name and the row's action.
    const row = card?.parentElement;
    expect(row?.getAttribute("role")).toBe("button");
    expect(row?.getAttribute("aria-label")).toContain("Select ticket GH-7");
    expect(card?.textContent).toContain("Start Run");
    expect(card?.textContent).toContain("Ticket GH-7");
  });

  it("says a list with no tickets through the EmptyState block", async () => {
    const { container } = renderQueue([]);

    const empty = await waitFor(() => {
      const el = container.querySelector("#queue-tickets-list .ui-empty-state");
      if (el === null) throw new Error("empty state missing");
      return el;
    });
    expect(empty.textContent).toContain(QUEUE_COPY.emptyTitle);
    expect(empty.textContent).toContain(QUEUE_COPY.empty("x-factory"));
  });

  it("claims the shell's page heading and renders no header of its own", async () => {
    const { container } = renderQueue([ticket("GH-8")]);

    const claimed = container.querySelector('[data-testid="claimed-heading"]');
    await waitFor(() => {
      expect(claimed?.textContent).toBe("Tickets");
    });
    // G7 in spirit: the view owns no page `<header>` and no heading class.
    expect(container.querySelector("#area-queue header")).toBeNull();
  });

  it("draws the toolbar glyphs through the Icon block, spin when refreshing", () => {
    const { container, rerender } = render(
      <TicketSearchToolbar
        searchQuery=""
        onSearchChange={() => {}}
        onRefresh={() => {}}
        isRefreshing={false}
        workflowLabel="x-factory"
      />,
    );

    const hrefs = [...container.querySelectorAll("svg.icon use")].map((use) =>
      use.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/assets/icons/sprite.svg#icon-search",
      "/assets/icons/sprite.svg#icon-refresh-cw",
    ]);
    // The field's size comes from the text style, not the stylesheet.
    expect(
      container
        .querySelector("#queue-search")
        ?.classList.contains("text-subhead"),
    ).toBe(true);

    rerender(
      <TicketSearchToolbar
        searchQuery=""
        onSearchChange={() => {}}
        onRefresh={() => {}}
        isRefreshing
        workflowLabel="x-factory"
      />,
    );
    expect(
      container.querySelector("svg.icon.icon-spin use")?.getAttribute("href"),
    ).toBe("/assets/icons/sprite.svg#icon-refresh-cw");
  });
});
