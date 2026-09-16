// test/per-project-ui.test.ts — Unit tests for Per-Project Tracker UI components, templates, and wizard validation

import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("Per-Project Tracker UI & Templates", () => {
  it("Settings view includes read-only Connections Registry table and no global tracker inputs", async () => {
    const settingsViewPath = path.join(
      import.meta.dir,
      "../public/js/views/settings.ts",
    );
    const content = await Bun.file(settingsViewPath).text();

    expect(content).toContain('data-tab="trackers"');
    expect(content).toContain("Connections");
    expect(content).toContain('id="tab-trackers"');
    expect(content).toContain('id="connections-registry-tbody"');
    expect(content).toContain("Tracker Connections");
    // Ensure legacy global tracker fields are completely removed
    expect(content).not.toContain("setting-tracker-azure-pat");
    expect(content).not.toContain("setting-tracker-jira-token");
    expect(content).not.toContain("setting-tracker-github-token");
  });

  it("Settings logic populates connections registry with project tracker links", async () => {
    const settingsJsPath = path.join(
      import.meta.dir,
      "../public/js/settings.ts",
    );
    const content = await Bun.file(settingsJsPath).text();

    expect(content).toContain("renderConnectionsRegistry");
    expect(content).toContain("connections-registry-tbody");
    expect(content).toContain("/projects?includeArchived=true");
    expect(content).toContain('href="#/projects/');
  });

  it("Projects view includes dedicated tracker section and collapsible archived projects section", async () => {
    const projectsViewPath = path.join(
      import.meta.dir,
      "../public/js/views/projects.ts",
    );
    const content = await Bun.file(projectsViewPath).text();

    expect(content).toContain('id="project-tracker-section"');
    expect(content).toContain('class="project-tracker-card card"');
    expect(content).toContain('id="archived-projects-section"');
    expect(content).toContain('id="btn-toggle-archived"');
    expect(content).toContain('id="archived-projects-container"');
  });

  it("Projects logic renders locked badge, credential status, test connection, rotation, and migration", async () => {
    const projectsJsPath = path.join(
      import.meta.dir,
      "../public/js/projects.ts",
    );
    const content = await Bun.file(projectsJsPath).text();

    expect(content).toContain("renderProjectTrackerCard");
    expect(content).toContain("🔒");
    expect(content).toContain("Per-project issue tracker configuration");
    expect(content).toContain("/tracker");
    expect(content).toContain("/tracker/test");
    expect(content).toContain("/tracker/credentials");
    expect(content).toContain("/migrate");
    expect(content).toContain("Switch Tracker / Migrate Project");
    expect(content).toContain("active runs");
    expect(content).toContain("activeRuns");
  });

  it("Onboarding Wizard step 2 requires tracker platform and contains no skip/none option", async () => {
    const modalsViewPath = path.join(
      import.meta.dir,
      "../public/js/views/modals.ts",
    );
    const content = await Bun.file(modalsViewPath).text();

    expect(content).toContain('id="onboard-step-2"');
    expect(content).toContain('id="onboard-tracker-connection"');
    expect(content).toContain('value="azure"');
    expect(content).toContain('value="github"');
    expect(content).toContain('value="jira"');
    // Ensure no 'skip' or 'none' option exists
    expect(content).not.toContain('value="none"');
    expect(content).not.toContain('value="skip"');
  });

  it("Wizard client validation enforces tracker fields before advancing past Step 2", async () => {
    const wizardJsPath = path.join(import.meta.dir, "../public/js/wizard.ts");
    const content = await Bun.file(wizardJsPath).text();

    expect(content).toContain("Azure Organization URL is required");
    expect(content).toContain("Azure Project Name is required");
    expect(content).toContain("Jira Host URL is required");
    expect(content).toContain("Jira Email is required");
    expect(content).toContain("GitHub Repository (owner/repo) is required");
  });

  it("Wizard actions saves credentials directly to project .env", async () => {
    const wizardActionsPath = path.join(
      import.meta.dir,
      "../public/js/wizard-actions.ts",
    );
    const content = await Bun.file(wizardActionsPath).text();

    expect(content).toContain("/tracker/credentials");
    expect(content).toContain("config.id");
    expect(content).toContain("state.tracker");
  });
});
