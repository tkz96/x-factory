// test/per-project-ui.test.ts — Unit tests for React Per-Project Tracker UI components and wizard validation

import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("Per-Project Tracker UI & Templates (React 19 Frontend)", () => {
  it("Settings view includes read-only Connections Registry table and no global tracker inputs", async () => {
    const settingsViewPath = path.join(
      import.meta.dir,
      "../src/frontend/views/SettingsView.tsx",
    );
    const content = await Bun.file(settingsViewPath).text();

    expect(content).toContain('data-tab="trackers"');
    expect(content).toContain("Connections");
    expect(content).toContain('id="tab-trackers"');
    expect(content).toContain('id="connections-registry-tbody"');
    // The registry title is canonical copy (#147): it lives in the copy map,
    // not inline in the view.
    expect(content).toContain("CONNECTIONS_COPY.registryTitle");
    expect(content).not.toContain("Tracker Connections");
    // Ensure legacy global tracker fields are completely removed
    expect(content).not.toContain("setting-tracker-azure-pat");
    expect(content).not.toContain("setting-tracker-jira-token");
    expect(content).not.toContain("setting-tracker-github-token");
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
    expect(content).toContain("api.testAzureScopes");
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
