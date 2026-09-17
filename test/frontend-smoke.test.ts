// test/frontend-smoke.test.ts — Lightweight DOM, navigation, view template, and client bundle smoke tests.

import { describe, expect, it } from "bun:test";
import path from "node:path";

const PUBLIC_DIR = path.resolve(import.meta.dir, "..", "public");

describe("Frontend Smoke — App Shell, Navigation & Views", () => {
  describe("App Shell & Root Markup", () => {
    it("index.html contains expected application shell elements", async () => {
      const html = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();

      // Meta and resources
      expect(html).toContain("<title>X-Factory</title>");
      expect(html).toContain('href="/favicon.svg"');
      expect(html).toContain('href="/styles.css"');
      expect(html).toContain('src="/app.js"');

      // Core layout containers
      expect(html).toContain('id="app-shell"');
      expect(html).toContain('id="app-sidebar"');
      expect(html).toContain('id="select-project"');
      expect(html).toContain('id="sidebar-nav"');
      expect(html).toContain('id="modal-container"');
    });

    it("defines navigation routes for all workbench views", async () => {
      const html = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();

      // Desktop and mobile navigation items
      expect(html).toContain('href="#/queue"');
      expect(html).toContain('href="#/runs"');
      expect(html).toContain('href="#/projects"');
      expect(html).toContain('href="#/settings"');
      expect(html).toContain('id="queue-badge"');
    });
  });

  describe("View Templates & Controller Wiring", () => {
    it("Work Queue template defines required controls and accessibility attributes", async () => {
      const queueView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/queue.ts"),
      ).text();
      const queueLogic = await Bun.file(
        path.join(PUBLIC_DIR, "js/queue.ts"),
      ).text();

      expect(queueView).toContain('id="btn-queue-refresh"');
      expect(queueView).toContain('id="queue-search"');
      expect(queueView).toContain('id="queue-tickets-list"');
      expect(queueView).toContain('aria-label="Refresh work queue"');

      // Wiring
      expect(queueLogic).toContain(
        '$<HTMLButtonElement>("#btn-queue-refresh")',
      );
      expect(queueLogic).toContain('$<HTMLInputElement>("#queue-search")');
    });

    it("Active Runs template defines stepper and launch trigger controls", async () => {
      const runsView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/runs.ts"),
      ).text();

      expect(runsView).toContain('id="btn-runs-start"');
      expect(runsView).toContain('id="workflow-stepper"');
      expect(runsView).toContain('id="view-run"');
      expect(runsView).toContain('id="view-result"');
    });

    it("Projects template defines 2-column grid and switchable active/archived tabs", async () => {
      const projectsView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/projects.ts"),
      ).text();
      const projectsLogic = await Bun.file(
        path.join(PUBLIC_DIR, "js/projects.ts"),
      ).text();

      expect(projectsView).toContain('id="btn-tab-active-projects"');
      expect(projectsView).toContain('id="btn-toggle-archived"');
      expect(projectsView).toContain('id="projects-container"');
      expect(projectsView).toContain('id="archived-projects-container"');

      // Segmented control handling
      expect(projectsLogic).toContain("activeProjectsTab");
      expect(projectsLogic).toContain('btnTabActive.classList.add("active")');
      expect(projectsLogic).toContain(
        'btnToggleArchived.classList.add("active")',
      );
    });

    it("Settings view defines tabs and appearance segmented control", async () => {
      const settingsView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/settings.ts"),
      ).text();
      const settingsLogic = await Bun.file(
        path.join(PUBLIC_DIR, "js/settings.ts"),
      ).text();

      expect(settingsView).toContain('id="btn-theme-light"');
      expect(settingsView).toContain('id="btn-theme-dark"');
      expect(settingsView).toContain('id="btn-save-settings"');
      expect(settingsView).toContain("Save Model Settings");

      // Theme toggle logic
      expect(settingsLogic).toContain("data-theme");
      expect(settingsLogic).toContain('localStorage.setItem("xf_theme"');
    });

    it("Modal templates define onboarding wizard and new run dialogs", async () => {
      const modalView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/modals.ts"),
      ).text();

      expect(modalView).toContain('id="modal-project-onboarding"');
      expect(modalView).toContain('id="modal-new-run"');
    });
  });

  describe("Client Bundle Syntax Integrity", () => {
    it("bundles public/app.ts without syntax or module resolution errors", async () => {
      const buildResult = await Bun.build({
        entrypoints: [path.join(PUBLIC_DIR, "app.ts")],
        target: "browser",
        format: "esm",
        minify: true,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.outputs.length).toBeGreaterThan(0);

      const output = await buildResult.outputs[0]?.text();
      expect(output).toBeDefined();
      expect(output?.length).toBeGreaterThan(10000);
    });
  });
});
