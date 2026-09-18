// test/frontend-smoke.test.ts — Lightweight DOM, navigation, view template, and client bundle smoke tests.

import { describe, expect, it } from "bun:test";
import path from "node:path";
import { renderIcon } from "../public/js/dom.js";

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

    it("Modal templates define onboarding wizard, git host selector, and PAT diagnostics", async () => {
      const modalView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/modals.ts"),
      ).text();

      expect(modalView).toContain('id="modal-project-onboarding"');
      expect(modalView).toContain('id="modal-new-run"');
      expect(modalView).toContain('id="onboard-git-host"');
      expect(modalView).toContain('id="azure-scope-diagnostic-card"');
      expect(modalView).toContain('href="/docs#azure-pat"');
      expect(modalView).toContain('href="/docs#azure-code"');
    });

    it("docs.html exists and contains comprehensive PAT and scopes reference", async () => {
      const docsHtml = await Bun.file(
        path.join(PUBLIC_DIR, "docs.html"),
      ).text();

      expect(docsHtml).toContain("X-Factory Documentation");
      expect(docsHtml).toContain('id="azure-pat"');
      expect(docsHtml).toContain('id="azure-code"');
      expect(docsHtml).toContain('id="github"');
      expect(docsHtml).toContain('id="gitlab"');
      expect(docsHtml).toContain('id="jira"');
      expect(docsHtml).toContain('id="least-privilege"');
      expect(docsHtml).toContain("Code: Status");
      expect(docsHtml).toContain("Work Items: Read");
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

  describe("Icon Design System & Anti-Drift Enforcement", () => {
    it("enforces zero inline SVG paths/polygons in index.html and docs.html", async () => {
      const indexHtml = await Bun.file(
        path.join(PUBLIC_DIR, "index.html"),
      ).text();
      const docsHtml = await Bun.file(
        path.join(PUBLIC_DIR, "docs.html"),
      ).text();

      // Check that all SVGs in index.html use the centralized sprite sheet
      const indexSvgMatches = indexHtml.match(/<svg[\s\S]*?<\/svg>/g) || [];
      expect(indexSvgMatches.length).toBeGreaterThan(0);
      for (const svg of indexSvgMatches) {
        expect(svg).toContain('<use href="/assets/icons/sprite.svg#icon-');
        expect(svg).not.toContain("<path ");
        expect(svg).not.toContain("<polygon ");
        expect(svg).not.toContain("<polyline ");
      }

      // Check that all SVGs in docs.html use the centralized sprite sheet (excluding code samples)
      const docsNonCode = docsHtml.replace(/<code>[\s\S]*?<\/code>/g, "");
      const docsSvgMatches = docsNonCode.match(/<svg[\s\S]*?<\/svg>/g) || [];
      expect(docsSvgMatches.length).toBeGreaterThan(0);
      for (const svg of docsSvgMatches) {
        expect(svg).toContain('<use href="/assets/icons/sprite.svg#icon-');
        expect(svg).not.toContain("<path ");
        expect(svg).not.toContain("<polygon ");
      }
    });

    it("verifies sprite.svg defines all approved symbols and matches individual source files", async () => {
      const spritePath = path.join(PUBLIC_DIR, "assets/icons/sprite.svg");
      const spriteText = await Bun.file(spritePath).text();

      const symbolMatches =
        spriteText.match(/<symbol id="icon-([^"]+)"/g) || [];
      const definedIds = symbolMatches.map((m) =>
        m.replace('<symbol id="icon-', "").replace('"', ""),
      );

      expect(definedIds.length).toBeGreaterThanOrEqual(27);
      expect(definedIds).toContain("layers");
      expect(definedIds).toContain("play");
      expect(definedIds).toContain("clock");
      expect(definedIds).toContain("folder");
      expect(definedIds).toContain("settings");
      expect(definedIds).toContain("book-open");
      expect(definedIds).toContain("check-circle-2");
      expect(definedIds).toContain("x-circle");
      expect(definedIds).toContain("loader-2");
      expect(definedIds).toContain("azure");
      expect(definedIds).toContain("github");
      expect(definedIds).toContain("gitlab");
      expect(definedIds).toContain("jira");

      // Verify every symbol in sprite.svg has a corresponding source SVG in assets/icons/
      for (const id of definedIds) {
        const uiFile = Bun.file(
          path.join(PUBLIC_DIR, `assets/icons/ui/${id}.svg`),
        );
        const brandFile = Bun.file(
          path.join(PUBLIC_DIR, `assets/icons/brands/${id}.svg`),
        );
        const exists = (await uiFile.exists()) || (await brandFile.exists());
        expect(exists).toBe(true);
      }
    });

    it("verifies all sprite <use> references in HTML point to valid defined symbols", async () => {
      const spriteText = await Bun.file(
        path.join(PUBLIC_DIR, "assets/icons/sprite.svg"),
      ).text();
      const indexHtml = await Bun.file(
        path.join(PUBLIC_DIR, "index.html"),
      ).text();
      const docsHtml = await Bun.file(
        path.join(PUBLIC_DIR, "docs.html"),
      ).text();

      const refMatches = [
        ...(indexHtml.match(
          /href="\/assets\/icons\/sprite\.svg#icon-([^"]+)"/g,
        ) || []),
        ...(docsHtml.match(
          /href="\/assets\/icons\/sprite\.svg#icon-([^"]+)"/g,
        ) || []),
      ];

      expect(refMatches.length).toBeGreaterThan(0);
      for (const ref of refMatches) {
        const iconName = ref
          .replace('href="/assets/icons/sprite.svg#icon-', "")
          .replace('"', "");
        expect(spriteText).toContain(`id="icon-${iconName}"`);
      }
    });

    it("strictly prohibits raw status emojis in wizard logic and views", async () => {
      const wizardRender = await Bun.file(
        path.join(PUBLIC_DIR, "js/wizard-render.ts"),
      ).text();
      const modalsView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/modals.ts"),
      ).text();

      // No raw emojis allowed for statuses
      expect(wizardRender).not.toContain("✅");
      expect(wizardRender).not.toContain("❌");
      expect(wizardRender).not.toContain("⏳");

      expect(modalsView).not.toContain("⏳");
      expect(modalsView).not.toContain("✅");
      expect(modalsView).not.toContain("❌");
    });

    it("verifies styles.css provides standardized .icon and size modifier classes", async () => {
      const css = await Bun.file(path.join(PUBLIC_DIR, "styles.css")).text();

      expect(css).toContain(".icon {");
      expect(css).toContain(".icon-xs {");
      expect(css).toContain(".icon-sm {");
      expect(css).toContain(".icon-md {");
      expect(css).toContain(".icon-lg {");
      expect(css).toContain(".icon-xl {");
      expect(css).toContain(".icon-spin {");
      expect(css).toContain(".icon-status-passed {");
      expect(css).toContain(".icon-status-failed {");
    });

    it("renderIcon generates compliant HTML strings with aria-hidden and sprite reference", () => {
      const rendered = renderIcon("search", "sm", "custom-class");
      expect(rendered).toContain('class="icon icon-sm custom-class"');
      expect(rendered).toContain('aria-hidden="true"');
      expect(rendered).toContain(
        '<use href="/assets/icons/sprite.svg#icon-search"></use>',
      );
    });
  });

  describe("PAT Verification & Over-Privilege UI Architecture", () => {
    it("modal markup contains scope card, responsibility notice, and ack checkbox", async () => {
      const modalsView = await Bun.file(
        path.join(PUBLIC_DIR, "js/views/modals.ts"),
      ).text();

      // Card & Header
      expect(modalsView).toContain('id="azure-scope-diagnostic-card"');
      expect(modalsView).toContain('id="scope-status-pill"');
      expect(modalsView).toContain("PAT Verification & Privileges");

      // Responsibility Notice
      expect(modalsView).toContain('id="scope-responsibility-notice"');
      expect(modalsView).toContain("Scope Responsibility Notice:");
      expect(modalsView).toContain("Work Items: Read");
      expect(modalsView).toContain("Code: Read & write");
      expect(modalsView).toContain("Code: Status");

      // Scope rows
      expect(modalsView).toContain('id="scope-row-wit-read"');
      expect(modalsView).toContain('id="scope-row-code-read"');
      expect(modalsView).toContain('id="scope-row-code-status"');
      expect(modalsView).toContain('id="scope-row-wit-write"');
      expect(modalsView).toContain('id="scope-row-code-full"');

      // Over-privilege warning and acknowledgement checkbox
      expect(modalsView).toContain('id="scope-overprivileged-warning"');
      expect(modalsView).toContain('id="scope-overprivileged-text"');
      expect(modalsView).toContain('id="chk-pat-least-privilege-ack"');
      expect(modalsView).toContain(
        "I understand that X-Factory only needs minimal permissions and accept responsibility for this token's scopes.",
      );
    });

    it("wizard logic enforces 'Verified Token Privileges' label and acknowledgement gating", async () => {
      const wizardRender = await Bun.file(
        path.join(PUBLIC_DIR, "js/wizard-render.ts"),
      ).text();
      const wizardLogic = await Bun.file(
        path.join(PUBLIC_DIR, "js/wizard.ts"),
      ).text();

      // Status pill states
      expect(wizardRender).toContain('"Verified Token Privileges"');
      expect(wizardRender).toContain('"Notice: Over-Privileged"');
      expect(wizardRender).toContain('"Missing Required Scopes"');

      // Gate enforcement
      expect(wizardLogic).toContain("overPrivileged");
      expect(wizardLogic).toContain("#chk-pat-least-privilege-ack");
      expect(wizardLogic).toContain(
        "Please check 'I understand' to acknowledge this token's permissions before continuing.",
      );
    });
  });
});
