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
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

function renderSettings() {
  const queryClient = new QueryClient({
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

  it("Settings view renders the read-only Connections Registry with the copy map's title, and no global tracker inputs", async () => {
    const settingsViewPath = path.join(
      import.meta.dir,
      "../src/frontend/views/SettingsView.tsx",
    );
    const content = await Bun.file(settingsViewPath).text();

    // The source keeps the legacy global tracker inputs deleted.
    expect(content).not.toContain("setting-tracker-azure-pat");
    expect(content).not.toContain("setting-tracker-jira-token");
    expect(content).not.toContain("setting-tracker-github-token");

    const { container } = renderSettings();
    fireEvent.click(
      container.querySelector('[data-tab="trackers"]') as Element,
    );

    // Rendered output: the registry is the Connections tab, its title and
    // subtitle are the copy map's strings, and its table is present.
    const registry = container.querySelector("#tab-trackers");
    expect(registry).not.toBeNull();
    expect(registry?.textContent).toContain(CONNECTIONS_COPY.registryTitle);
    expect(registry?.textContent).toContain(CONNECTIONS_COPY.registrySubtitle);
    expect(
      container.querySelector("#connections-registry-tbody"),
    ).not.toBeNull();
  });

  it("Settings logic populates connections registry with project tracker links", async () => {
    const settingsViewPath = path.join(
      import.meta.dir,
      "../src/frontend/views/SettingsView.tsx",
    );
    const content = await Bun.file(settingsViewPath).text();

    expect(content).toContain("useProjects");
    expect(content).toContain("connections-registry-tbody");
    expect(content).toContain("projects.map");
    expect(content).toContain("encodeURIComponent(p.id)");
  });

  it("Projects view includes dedicated tracker section and collapsible archived projects section", async () => {
    const projectsViewPath = path.join(
      import.meta.dir,
      "../src/frontend/views/ProjectsView.tsx",
    );
    const projectsContent = await Bun.file(projectsViewPath).text();

    expect(projectsContent).toContain('id="archived-projects-section"');
    expect(projectsContent).toContain('id="btn-toggle-archived"');
    expect(projectsContent).toContain('id="archived-projects-container"');

    const trackerSectionPath = path.join(
      import.meta.dir,
      "../src/frontend/components/projects/TrackerSection.tsx",
    );
    const trackerContent = await Bun.file(trackerSectionPath).text();

    expect(trackerContent).toContain('id="project-tracker-section"');
    expect(trackerContent).toContain('className="project-tracker-card card"');
  });

  // Rewritten for ticket #147. The previous assertions pinned the
  // provider-conditional rendering this ticket deletes: TrackerSection read
  // `tracker.provider` and reached into `tracker.azure` / `tracker.jira` /
  // `tracker.github`, and its copy was inline. The card is now driven by the
  // project's normalized connections; the strings live in the copy map and the
  // scope action is gated on the provider's declared capabilities. Behavioural
  // coverage of all of it lives in test/post-creation-surfacing.test.tsx.
  it("TrackerSection renders the tracker card from connections, with no provider conditionals", async () => {
    const trackerSectionPath = path.join(
      import.meta.dir,
      "../src/frontend/components/projects/TrackerSection.tsx",
    );
    const content = await Bun.file(trackerSectionPath).text();

    // Generic derivation + capability-driven action.
    expect(content).toContain("deriveConnectionIntegrity");
    expect(content).toContain('capabilities.includes("verifyScopes")');
    expect(content).toContain("api.testScopes");
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
