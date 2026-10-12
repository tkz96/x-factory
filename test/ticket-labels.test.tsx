// test/ticket-labels.test.tsx — A ticket row's tags are the ticket's own labels,
// and the label the tracker requires when the provider maps none (A4). Nothing
// on the row hard-codes a label, and the search field names the label it filters
// by instead of showing a pill that looks like a toggle.

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
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
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

function ticket(id: string, labels?: string[]): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    acceptanceCriteria: [],
    provider: "github",
    ...(labels ? { labels } : {}),
  };
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

describe("the ticket row's tags (A4)", () => {
  it("shows the ticket's own labels, and the tracker's label when it has none", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.providers(), MANIFEST);
    client.setQueryData(queryKeys.projects(), [PROJECT]);
    const tickets = [ticket("GH-3", ["bug", "ui"]), ticket("GH-4")];
    client.setQueryData(queryKeys.tickets(PROJECT.id), tickets);
    api.getTickets = mock(async () => tickets) as never;

    const { container } = render(
      <QueryClientProvider client={client}>
        <ProjectProvider>
          <ModalProvider>
            <MemoryRouter initialEntries={["/tickets"]}>
              <QueueView />
            </MemoryRouter>
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      if (container.querySelectorAll(".ticket-card").length === 0) {
        throw new Error("ticket rows missing");
      }
    });

    const cards = [...container.querySelectorAll(".ticket-card")];
    const tagsOf = (index: number) =>
      [...(cards[index]?.querySelectorAll(".ticket-tags .ui-badge") ?? [])].map(
        (badge) => badge.textContent,
      );

    expect(tagsOf(0)).toEqual(["bug", "ui"]);
    // No labels of its own: the label the tracker requires, never a literal.
    expect(tagsOf(1)).toEqual(["x-factory"]);
    expect(container.textContent).not.toContain("agentic-workflow");

    // The label is a fact the field states, not a control on the toolbar.
    const field = container.querySelector("#queue-search");
    expect(field?.getAttribute("placeholder")).toBe(
      "Filter tickets (label: x-factory)…",
    );
    expect(container.querySelector(".filter-pill")).toBeNull();
  });
});
