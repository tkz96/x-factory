// test/per-project-ui.test.ts — Unit tests for React Per-Project Tracker UI components and wizard validation
//
// Where a surface RENDERS, the assertions are on rendered output: source-text
// assertions can pass while the copy on screen is wrong. Source-text checks are
// kept only where the claim is about the source itself (an id that must not
// exist, a module that must not declare a provider conditional).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

function renderSettings(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        null,
        createElement(ModalProvider, null, createElement(SettingsView)),
      ),
    ),
  );
}

describe("Per-Project Tracker UI & Templates (React 19 Frontend)", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("Settings › Connections shows the read-only registry under the copy map's title", () => {
    const { getByRole, getByText } = renderSettings();
    fireEvent.click(getByRole("link", { name: "Connections" }));

    // Rendered output: the registry's title and subtitle are the copy map's
    // strings, and it is a table. No global tracker inputs exist in the source.
    expect(getByText(CONNECTIONS_COPY.registryTitle)).toBeTruthy();
    expect(getByText(CONNECTIONS_COPY.registrySubtitle)).toBeTruthy();
    expect(getByRole("table")).toBeTruthy();
  });

  it("Settings › Connections links each project row to its own page", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.projects(), [
      { id: "alpha-id", name: "Alpha", archived: false, connections: [] },
    ]);
    const { getByRole } = renderSettings(client);
    fireEvent.click(getByRole("link", { name: "Connections" }));

    const row = within(getByRole("table")).getAllByRole("row")[1];
    expect(row?.textContent).toContain("Alpha");
    const link = within(row as HTMLElement).getByRole("link", {
      name: CONNECTIONS_COPY.registryAction,
    });
    expect(link.getAttribute("href")).toBe("/projects/alpha-id");
  });

  // Ticket #267 replaced the project cards and the Active/Archived tab bar: the
  // Projects screen is now a list with a detail pane, its rows linking to each
  // project's own route. The ids this test used to pin
  // (`#archived-projects-container`, `#btn-toggle-archived`,
  // `#archived-projects-section`) are gone with the tab bar, and asserting them
  // proved nothing about what a user gets. The screen is now asserted by
  // behaviour — its rows, its filter, its empty state and its toolbar action —
  // in test/projects-split.test.tsx.
  it("TrackerSection renders the tracker card from connections, with no provider conditionals", async () => {
    // Rewritten for ticket #147. The previous assertions pinned the
    // provider-conditional rendering this ticket deletes: TrackerSection read
    // `tracker.provider` and reached into `tracker.azure` / `tracker.jira` /
    // `tracker.github`, and its copy was inline. The card is now driven by the
    // project's normalized connections; the strings live in the copy map and the
    // scope action is gated on the provider's declared capabilities. Behavioural
    // coverage of all of it lives in test/post-creation-surfacing.test.tsx.
    const trackerSectionPath = path.join(
      import.meta.dir,
      "../src/frontend/components/projects/TrackerSection.tsx",
    );
    const content = await Bun.file(trackerSectionPath).text();

    expect(content).toContain('id="project-tracker-section"');
    // Generic derivation + capability-driven action.
    expect(content).toContain("deriveConnectionIntegrity");
    expect(content).toContain('capabilities.includes("verifyScopes")');
    expect(content).toContain("api.verifyProjectScopes");
    // The integrity failure with its repair path (spec #133 story 49).
    expect(content).toContain("CONNECTIONS_COPY.integrityFailure");
    expect(content).toContain("CONNECTIONS_COPY.reconnect");
    // Copy comes from the map, never inline.
    expect(content).toContain("CONNECTIONS_COPY.ingestionLabel");
    expect(content).not.toContain("Ingestion Label");
    // No provider-conditional reads anywhere on this surface. (`providerId` is
    // the generic connection field, not a provider branch.)
    expect(content).not.toMatch(/tracker\.provider\b/);
    expect(content).not.toMatch(/tracker\.(azure|jira|github)\b/);
    expect(content).not.toContain("issueTracker");
  });
});
