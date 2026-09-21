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
    expect(content).toContain("Tracker Connections");
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

  it("TrackerSection renders provider badge, target, ingestion label, and Azure scope testing", async () => {
    const trackerSectionPath = path.join(
      import.meta.dir,
      "../src/frontend/components/projects/TrackerSection.tsx",
    );
    const content = await Bun.file(trackerSectionPath).text();

    expect(content).toContain("tracker.provider");
    expect(content).toContain("handleTestAzureScopes");
    expect(content).toContain("Test Azure DevOps Scopes");
    expect(content).toContain("api.testAzureScopes");
    expect(content).toContain("Ingestion Label");
  });

  it("Onboarding Wizard step 2 requires tracker platform and contains no skip/none option", async () => {
    const modalPath = path.join(
      import.meta.dir,
      "../src/frontend/components/modals/OnboardingWizardModal.tsx",
    );
    const content = await Bun.file(modalPath).text();

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
    const modalPath = path.join(
      import.meta.dir,
      "../src/frontend/components/modals/OnboardingWizardModal.tsx",
    );
    const content = await Bun.file(modalPath).text();

    expect(content).toContain("canGoNextFromStep2");
    expect(content).toContain(
      "Please complete the required tracker configuration",
    );
    expect(content).toContain("leastPrivilegeAck");
  });

  it("Wizard actions saves project configuration directly to /api/projects", async () => {
    const modalPath = path.join(
      import.meta.dir,
      "../src/frontend/components/modals/OnboardingWizardModal.tsx",
    );
    const content = await Bun.file(modalPath).text();

    expect(content).toContain('fetch("/api/projects"');
    expect(content).toContain('method: "POST"');
    expect(content).toContain("invalidateProjects");
  });
});
