// test/frontend-smoke.test.ts — React application structure, routing, views, and components smoke tests.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/frontend/App.js";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { DocsSidebarNav } from "../src/frontend/components/docs/DocsSidebarNav.js";
import { RunHistoryCard } from "../src/frontend/components/history/RunHistoryCard.js";
import { ModalContainer } from "../src/frontend/components/ModalContainer.js";
import { ProjectCard } from "../src/frontend/components/projects/ProjectCard.js";
import { ReadinessBanner } from "../src/frontend/components/projects/ReadinessBanner.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { DiffModal } from "../src/frontend/components/runs/DiffModal.js";
import { HumanCheckpointSection } from "../src/frontend/components/runs/HumanCheckpointSection.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { WorkflowStepper } from "../src/frontend/components/runs/WorkflowStepper.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { routeDefinitions, router } from "../src/frontend/routes.js";
import { DocsView } from "../src/frontend/views/DocsView.js";
import { HistoryView } from "../src/frontend/views/HistoryView.js";
import { ProjectDetailView } from "../src/frontend/views/ProjectDetailView.js";
import { ProjectsView } from "../src/frontend/views/ProjectsView.js";
import { QueueView } from "../src/frontend/views/QueueView.js";
import { RunDetailView } from "../src/frontend/views/RunDetailView.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";
import {
  defaultSources,
  type OffOriginReference,
  type SourceKind,
  scanSource,
  scanSources,
} from "./helpers/off-origin-scan.js";

const ROOT_DIR = path.resolve(import.meta.dir, "..");

function renderWithProviders(
  ui: React.ReactElement,
  initialEntries: string[] = ["/"],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return renderToString(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        ProjectProvider,
        null,
        React.createElement(
          ModalProvider,
          null,
          React.createElement(MemoryRouter, { initialEntries }, ui),
        ),
      ),
    ),
  );
}

describe("Frontend Smoke — React Application Structure & Views", () => {
  describe("React Root & Entrypoint", () => {
    it("index.html contains React root container and module script entrypoint", async () => {
      const html = await Bun.file(path.join(ROOT_DIR, "index.html")).text();

      expect(html).toContain('<div id="root"></div>');
      expect(html).toContain('src="/src/frontend/main.tsx"');
      expect(html).toContain('type="module"');
      expect(html).toContain("<title>X-Factory</title>");
      expect(html).toContain('href="/styles.css"');
      expect(html).toContain('href="/favicon.svg"');
    });

    it("src/frontend/main.tsx mounts App inside StrictMode on #root", async () => {
      const mainTsx = await Bun.file(
        path.join(ROOT_DIR, "src/frontend/main.tsx"),
      ).text();

      expect(mainTsx).toContain('document.getElementById("root")');
      expect(mainTsx).toContain("createRoot");
      expect(mainTsx).toContain("<StrictMode>");
      expect(mainTsx).toContain("<App />");
    });

    it("src/frontend/App.tsx wires QueryClientProvider and RouterProvider", async () => {
      const appTsx = await Bun.file(
        path.join(ROOT_DIR, "src/frontend/App.tsx"),
      ).text();

      expect(appTsx).toContain("<QueryClientProvider");
      expect(appTsx).toContain("<RouterProvider");
      expect(appTsx).toContain("client={queryClient}");
      expect(appTsx).toContain("router={router}");

      // Verify SSR render does not throw
      const rendered = renderToString(React.createElement(App));
      expect(rendered).toContain("app-shell");
    });
  });

  describe("Router & Route Configuration", () => {
    it("declares root layout route with AppShell", () => {
      const rootRoute = routeDefinitions.find((r) => r.path === "/");
      expect(rootRoute).toBeDefined();
      expect(rootRoute?.element).toBeDefined();
      expect(rootRoute?.children).toBeDefined();
    });

    it("declares all expected canonical workbench routes", () => {
      const rootRoute = routeDefinitions.find((r) => r.path === "/");
      const children = rootRoute?.children || [];
      const paths = children.map((c) => c.path ?? (c.index ? "index" : ""));

      expect(paths).toContain("index");
      expect(paths).toContain("queue");
      expect(paths).toContain("runs");
      expect(paths).toContain("runs/:runId");
      expect(paths).toContain("history");
      expect(paths).toContain("projects");
      expect(paths).toContain("projects/:id");
      expect(paths).toContain("settings");
      expect(paths).toContain("docs");
      expect(paths).toContain("*");
    });

    it("router instance is initialized", () => {
      expect(router).toBeDefined();
      expect(router.state).toBeDefined();
    });
  });

  describe("Critical Views", () => {
    it("QueueView renders search bar, refresh button, and tickets section", () => {
      const html = renderWithProviders(React.createElement(QueueView));

      expect(html).toContain('id="area-queue"');
      expect(html).toContain('id="queue-search"');
      expect(html).toContain('id="btn-queue-refresh"');
      expect(html).toContain('id="queue-tickets-list"');
      expect(html).toContain("agentic-workflow");
    });

    it("ProjectsView renders segmented tabs and project catalog layout", () => {
      const html = renderWithProviders(React.createElement(ProjectsView));

      expect(html).toContain("Projects");
      expect(html).toContain("Active Projects");
      expect(html).toContain("Archived");
      expect(html).toContain("Onboard Project");
    });

    it("SettingsView renders tab navigation and settings sections", () => {
      const html = renderWithProviders(React.createElement(SettingsView));

      expect(html).toContain("Settings");
      expect(html).toContain("Connections");
      expect(html).toContain("Appearance");
      expect(html).toContain("Diagnostics");
    });

    it("DocsView renders documentation hierarchy, token requirements, and scope table", () => {
      const html = renderWithProviders(React.createElement(DocsView));

      expect(html).toContain("Principle of Least Privilege");
      expect(html).toContain("Security Guardrail");
    });

    it("HistoryView, RunsView, RunDetailView, and ProjectDetailView export functional components", () => {
      expect(typeof HistoryView).toBe("function");
      expect(typeof RunsView).toBe("function");
      expect(typeof RunDetailView).toBe("function");
      expect(typeof ProjectDetailView).toBe("function");
    });
  });

  describe("Critical Components", () => {
    it("AppShell renders navigation sidebar, header, and route outlets", () => {
      const html = renderWithProviders(React.createElement(AppShell));

      expect(html).toContain('id="app-shell"');
      expect(html).toContain("X-Factory");
      expect(html).toContain('href="/queue"');
      expect(html).toContain('href="/runs"');
      expect(html).toContain('href="/projects"');
      expect(html).toContain('href="/settings"');
      expect(html).toContain('href="/docs"');
    });

    it("AppShell renders Documentation ↗ link targeting new tab in workbench mode", () => {
      const html = renderWithProviders(React.createElement(AppShell), [
        "/queue",
      ]);

      expect(html).toContain('href="/docs"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain("Documentation ↗");
    });

    it("AppShell renders DocsSidebarNav when viewing documentation route", () => {
      const html = renderWithProviders(React.createElement(AppShell), [
        "/docs",
      ]);

      expect(html).toContain("X-Factory Docs");
      expect(html).toContain("Documentation");
      expect(html).toContain('href="/queue"');
      expect(html).toContain("Back to Workbench");
      expect(html).not.toContain("btn-open-new-run");
    });

    it("DocsSidebarNav exports functional component", () => {
      expect(typeof DocsSidebarNav).toBe("function");
    });

    it("ChatThread exports a functional component", () => {
      expect(typeof ChatThread).toBe("function");
    });

    it("RunChat and DiffModal export functional components and render cleanly", () => {
      expect(typeof RunChat).toBe("function");
      expect(typeof DiffModal).toBe("function");

      const diffModalHtml = renderToString(
        React.createElement(DiffModal, {
          isOpen: true,
          file: "src/sample.ts",
          added: 5,
          removed: 2,
          hunks: "@@ -1,2 +1,5 @@\n+line1\n-line2\n line3",
          onClose: () => {},
        }),
      );
      expect(diffModalHtml).toContain("src/sample.ts");
      expect(diffModalHtml).toContain("+5");
      expect(diffModalHtml).toContain("−2");
      expect(diffModalHtml).toContain("diff-row-add");
      expect(diffModalHtml).toContain("diff-row-del");
    });

    it("ProjectCard renders project name, tracker badge, and action links", () => {
      const html = renderWithProviders(
        React.createElement(ProjectCard, {
          project: {
            id: "proj-1",
            name: "X-Factory Core",
            repositoryPath: "/path/to/repo",
            defaultBranch: "main",
            testCommand: "bun test",
            repositories: [],
            issueTracker: {
              provider: "azure",
              azure: {
                orgUrl: "https://dev.azure.com/org",
                project: "proj",
              },
            },
          },
        }),
      );

      expect(html).toContain("X-Factory Core");
      expect(html).toContain("proj-1");
      expect(html).toContain("azure");
      expect(html).toContain("View Details →");
    });

    it("RunHistoryCard renders run ticket details, status, and duration", () => {
      const html = renderWithProviders(
        React.createElement(RunHistoryCard, {
          run: {
            id: "run-123",
            project: { id: "proj-1", name: "X-Factory Core" },
            ticket: {
              id: "TICK-42",
              title: "Fix frontend smoke test",
              url: "https://ticket.url",
              acceptanceCriteria: ["All tests pass"],
            },
            branch: "xf-tick-42",
            status: "ready_for_pr",
            plan: "Implementation plan",
            startedAt: "2026-09-20T12:00:00.000Z",
            finishedAt: "2026-09-20T12:05:00.000Z",
            updatedAt: "2026-09-20T12:05:00.000Z",
            implementationContext: null,
            verification: null,
            review: null,
            artifacts: [],
            diff: null,
            pullRequest: null,
            repairAttempts: 0,
            artifactsDir: "/tmp/artifacts",
            worktreePath: "/tmp/worktree",
          },
        }),
      );

      expect(html).toContain("TICK-42");
      expect(html).toContain("Fix frontend smoke test");
      expect(html).toContain("ready_for_pr");
    });

    it("WorkflowStepper renders workflow stages and active progression", () => {
      const html = renderToString(
        React.createElement(WorkflowStepper, {
          status: "executing",
        }),
      );

      expect(html).toContain("workflow-stepper");
      expect(html).toContain("Prepare");
      expect(html).toContain("Understand");
      expect(html).toContain("Plan");
      expect(html).toContain("Execute");
      expect(html).toContain("Review");
      expect(html).toContain("Deliver");
    });

    it("ReadinessBanner renders system tooling readiness state", () => {
      const html = renderWithProviders(React.createElement(ReadinessBanner));
      expect(html).toContain("readiness-banner");
    });

    it("ModalContainer renders modal dialog portal target", () => {
      const html = renderWithProviders(React.createElement(ModalContainer));
      expect(html).toBeDefined();
    });

    it("HumanCheckpointSection renders checkpoint heading and evidence sections cleanly", () => {
      const mockRun = {
        id: "run-smoke-1",
        project: { id: "p1", name: "Smoke Proj" },
        ticket: { id: "T-1", title: "Smoke Ticket", acceptanceCriteria: [] },
        plan: "plan",
        branch: "factory/smoke",
        status: "ready_for_pr" as const,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        updatedAt: new Date().toISOString(),
        implementationContext: null,
        verification: null,
        review: null,
        artifacts: [],
        diff: null,
        pullRequest: null,
        repairAttempts: 0,
        artifactsDir: "/tmp",
        worktreePath: "/tmp",
      };
      const html = renderWithProviders(
        React.createElement(HumanCheckpointSection, { run: mockRun }),
      );
      expect(html).toContain("Human Checkpoint &amp; Evidence");
      expect(html).toContain("Deterministic Verification");
      // The redesign names the roles, not Session A / Session B (#278).
      expect(html).toContain("Independent review (Reviewer)");
      // Delivery comes from the policy's own delivery set, not a local list.
      const withStatus = (
        status: "ready_for_pr" | "awaiting_review" | "pr_created",
      ) => ({ ...mockRun, status });
      expect(html).toContain("Create Pull Request");
      expect(
        renderWithProviders(
          React.createElement(HumanCheckpointSection, {
            run: withStatus("awaiting_review"),
          }),
        ),
      ).not.toContain('id="btn-pr"');
      expect(
        renderWithProviders(
          React.createElement(HumanCheckpointSection, {
            run: withStatus("pr_created"),
          }),
        ),
      ).toContain("Pull Request Created");
    });
  });

  describe("Design System & CSS Architecture Enforcement", () => {
    function getAllTsxFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllTsxFiles(fullPath));
        } else if (entry.name.endsWith(".tsx")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    it("enforces zero inline style={{ declarations across all frontend TSX files", () => {
      const frontendDir = path.join(ROOT_DIR, "src/frontend");
      const tsxFiles = getAllTsxFiles(frontendDir);
      const violations: { file: string; line: number; text: string }[] = [];

      for (const filePath of tsxFiles) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.includes("style={{")) {
            violations.push({
              file: path.relative(ROOT_DIR, filePath),
              line: i + 1,
              text: line.trim(),
            });
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it("verifies main.tsx imports the layered design system stylesheets", async () => {
      const mainContent = await Bun.file(
        path.join(ROOT_DIR, "src/frontend/main.tsx"),
      ).text();
      expect(mainContent).toContain('import "./styles/index.css"');
    });

    it("verifies index.css wires tokens, base, shared layers, and utilities in order", async () => {
      const indexCss = await Bun.file(
        path.join(ROOT_DIR, "src/frontend/styles/index.css"),
      ).text();
      expect(indexCss).toContain("./tokens.css");
      expect(indexCss).toContain("./base.css");
      expect(indexCss).toContain("./shared/buttons.css");
      expect(indexCss).toContain("./shared/cards.css");
      expect(indexCss).toContain("./shared/forms.css");
      expect(indexCss).toContain("./shared/badges.css");
      expect(indexCss).toContain("./shared/icons.css");
      expect(indexCss).toContain("./shared/scrollbar.css");
      expect(indexCss).toContain("./utilities.css");
    });
  });
});

// ─── Feedback System Enforcement (spec #133, ticket #135) ─────────────────

describe("Frontend Smoke — Feedback System Enforcement", () => {
  const FRONTEND_DIR = path.join(ROOT_DIR, "src/frontend");
  const FEEDBACK_DIR = path.join(FRONTEND_DIR, "components", "feedback");
  /** The one control vocabulary (#251) the feedback family renders through. */
  const BLOCKS_DIR = path.join(FRONTEND_DIR, "components", "ui");

  function getSourceFiles(dir: string, extensions: string[]): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getSourceFiles(fullPath, extensions));
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * Known anti-patterns for loading/error feedback. Honest scope per
   * docs/reference/state-coverage.md: this scan DETECTS known anti-patterns,
   * it does not PROVE coverage — behavioral tests are the real enforcement.
   */
  const ANTI_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
    { name: "ad-hoc spinner markup", pattern: /className="[^"]*spinner/i },
    { name: "ad-hoc generic error copy", pattern: /something went wrong/i },
    { name: "toast system", pattern: /\btoast\b/i },
    // Static placeholder rows are the approved loading shape (#251); an
    // animated shimmer is not, in markup or in CSS.
    { name: "shimmer animation", pattern: /\bshimmer\b/i },
  ];

  /**
   * Legacy files that still construct ad-hoc loading/error markup, pending
   * absorption by the wizard rebuild (spec #133). New files must never land
   * here; entries leave this list when their absorbing ticket deletes them.
   * ProjectDetailView and QueueView left it in #147, when both moved onto the
   * feedback family.
   */
  const LEGACY_ADHOC_FEEDBACK_FILES = new Set([
    "src/frontend/components/docs/DocsSidebarNav.tsx",
    "src/frontend/views/RunDetailView.tsx",
    "src/frontend/views/RunsView.tsx",
  ]);

  it("scans for known ad-hoc loading/error markup outside the feedback family", () => {
    const sourceFiles = getSourceFiles(FRONTEND_DIR, [".ts", ".tsx"]).filter(
      (filePath) => !filePath.startsWith(FEEDBACK_DIR),
    );
    const violations: Array<{
      file: string;
      line: number;
      pattern: string;
      text: string;
    }> = [];

    for (const filePath of sourceFiles) {
      const relative = path.relative(ROOT_DIR, filePath);
      if (LEGACY_ADHOC_FEEDBACK_FILES.has(relative)) {
        continue;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const { name, pattern } of ANTI_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: relative,
              line: i + 1,
              pattern: name,
              text: line.trim(),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces the feedback family import rule: feedback/ imports nothing screen-specific", () => {
    const feedbackFiles = getSourceFiles(FEEDBACK_DIR, [".ts", ".tsx"]);
    expect(feedbackFiles.length).toBeGreaterThan(0);

    // Two escapes are allowed, because neither is screen- or app-specific:
    //   - `src/shared`, the layer the architecture boundaries allow (`frontend`
    //     may import `shared`; `.fallowrc.json`) — the canonical provider error
    //     copy table lives there;
    //   - `components/ui`, the one control vocabulary (#251) the family renders
    //     through: buttons, badges, list rows, the spinner. It is as
    //     screen-agnostic as the family itself.
    // Every other escape lands in screen- or app-specific wiring and stays a
    // violation.
    const SHARED_DIR = path.join(ROOT_DIR, "src", "shared");

    const importPattern = /from\s+"(\.[^"]*)"/g;
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const filePath of feedbackFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const match of line.matchAll(importPattern)) {
          // A relative import starting with "../" escapes the feedback family.
          const specifier = match[1] ?? "";
          if (!specifier.startsWith("..")) {
            continue;
          }
          const resolved = path.resolve(path.dirname(filePath), specifier);
          if (
            resolved === SHARED_DIR ||
            resolved.startsWith(`${SHARED_DIR}${path.sep}`) ||
            resolved === BLOCKS_DIR ||
            resolved.startsWith(`${BLOCKS_DIR}${path.sep}`)
          ) {
            continue;
          }
          violations.push({
            file: path.relative(ROOT_DIR, filePath),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces the building-block import rule: components/ui imports nothing screen-specific", () => {
    // The blocks are the shared vocabulary every screen renders through, so
    // they may reach themselves, `src/shared` and the design tokens — nothing
    // else. A screen-specific import here would make the vocabulary app-bound.
    const blockFiles = getSourceFiles(BLOCKS_DIR, [".ts", ".tsx"]);
    expect(blockFiles.length).toBeGreaterThan(0);

    const SHARED_DIR = path.join(ROOT_DIR, "src", "shared");
    const importPattern = /from\s+"(\.[^"]*)"/g;
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const filePath of blockFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const match of line.matchAll(importPattern)) {
          const specifier = match[1] ?? "";
          if (!specifier.startsWith("..")) {
            continue;
          }
          const resolved = path.resolve(path.dirname(filePath), specifier);
          if (
            resolved === SHARED_DIR ||
            resolved.startsWith(`${SHARED_DIR}${path.sep}`)
          ) {
            continue;
          }
          violations.push({
            file: path.relative(ROOT_DIR, filePath),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("verifies the feedback family stays presentation-only (no query machinery)", async () => {
    // The known anti-pattern: query objects or query hooks crossing the
    // feedback boundary. AsyncRegion takes the derived state enum; nothing in
    // the family may import query machinery.
    const asyncRegionSource = await Bun.file(
      path.join(FEEDBACK_DIR, "AsyncRegion.tsx"),
    ).text();
    expect(asyncRegionSource).not.toContain("@tanstack/react-query");
    expect(asyncRegionSource).not.toContain("useQuery");

    const deriveSource = await Bun.file(
      path.join(FEEDBACK_DIR, "derive-async-state.ts"),
    ).text();
    expect(deriveSource).not.toContain("@tanstack/react-query");
    // Input staleness is the caller's predicate — never TanStack's own
    // cache-freshness flag.
    expect(deriveSource).not.toContain("isStale: boolean");
  });
});

describe("Frontend Smoke — CSS variable resolution", () => {
  function listFiles(dir: string, ext: string[]): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listFiles(full, ext));
      else if (ext.some((e) => entry.name.endsWith(e))) out.push(full);
    }
    return out;
  }

  const frontendDir = path.join(ROOT_DIR, "src/frontend");
  const sources = listFiles(frontendDir, [".css", ".tsx"]).map((file) => ({
    file: path.relative(ROOT_DIR, file),
    css: file.endsWith(".css"),
    text: fs.readFileSync(file, "utf-8"),
  }));

  it("every var(--x) used in frontend CSS resolves to a defined custom property", () => {
    const defined = new Set<string>();
    for (const { text, css } of sources) {
      const declaration = css
        ? /(?:^|[;{\s])(--[a-zA-Z0-9_-]+)\s*:/g
        : /["'](--[a-zA-Z0-9_-]+)["']\s*:/g;
      for (const m of text.matchAll(declaration)) defined.add(m[1] as string);
    }
    const undefinedUses: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
        if (!defined.has(m[1] as string)) {
          undefinedUses.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(undefinedUses).toEqual([]);
  });

  it("no var() carries a hard-coded colour fallback", () => {
    const offenders: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      for (const m of text.matchAll(
        /var\(\s*--[a-zA-Z0-9_-]+\s*,\s*(?:#|rgba?\(|hsla?\()[^)]*\)?/g,
      )) {
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no transition: all used in frontend CSS (#248)", () => {
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (/transition:\s*all\b/i.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no shimmer keyframes or shimmer animation in frontend CSS (#251)", () => {
    // Static placeholder rows are the approved loading shape (#251); an
    // animated shimmer stays banned, in any name.
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (/@keyframes\s+[^{]*shimmer/i.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
        if (/animation(?:-name)?\s*:[^;]*\bshimmer\b/i.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no hex, rgb, or rgba literals outside token files in frontend CSS (#248)", () => {
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      if (file.endsWith("tokens.css") || file.includes("tokens/")) continue;
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Check for hex or rgb/rgba literals
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /rgba?\([^)]+\)/i.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no px literals outside token files in frontend CSS (#248)", () => {
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      if (file.endsWith("tokens.css") || file.includes("tokens/")) continue;
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Media queries define viewport breakpoints, not component values
        if (line.trim().startsWith("@media")) continue;
        if (/\b\d+px\b/i.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── No third-party requests (spec #241, ticket #247) ──────────────────────

describe("Frontend Smoke — No third-party requests", () => {
  function synthetic(kind: SourceKind, text: string) {
    return { file: `synthetic.${kind}`, kind, text };
  }

  function described(findings: readonly OffOriginReference[]): string[] {
    return findings.map((f) => `${f.reason} ${f.url}`);
  }

  it("flags a script, stylesheet, image, font or sprite that names another host", () => {
    const findings = scanSource(
      synthetic(
        "html",
        [
          '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>',
          '<link rel="stylesheet" href="//fonts.example.com/inter.css">',
          '<img src="https://images.example.com/a.png">',
          '<img srcset="/a.png 1x, https://images.example.com/a2x.png 2x">',
          '<video poster="https://images.example.com/p.jpg"></video>',
          '<use href="https://icons.example.com/sprite.svg#play"></use>',
        ].join("\n"),
      ),
    );

    expect(described(findings)).toEqual([
      "<script src> https://cdn.jsdelivr.net/npm/@scalar/api-reference",
      "<link href> //fonts.example.com/inter.css",
      "<img src> https://images.example.com/a.png",
      "<img srcset> https://images.example.com/a2x.png",
      "<video poster> https://images.example.com/p.jpg",
      "<use href> https://icons.example.com/sprite.svg#play",
    ]);
    expect(findings[1]?.line).toBe(2);
  });

  it("flags @import, url() and a JavaScript request that names another host", () => {
    const css = scanSource(
      synthetic(
        "css",
        [
          '@import "https://fonts.example.com/inter.css";',
          '@import url("https://fonts.example.com/other.css");',
          ".a { background: url(//images.example.com/bg.png); }",
          '.b { background: url("/a.png"); }',
          '.c { background: url("/fonts/Inter-Regular.woff2") format("woff2"); }',
        ].join("\n"),
      ),
    );
    expect(described(css)).toEqual([
      "@import https://fonts.example.com/inter.css",
      "url() https://fonts.example.com/other.css",
      "url() //images.example.com/bg.png",
    ]);

    const script = scanSource(
      synthetic(
        "script",
        'fetch("https://api.example.com/v1");\nnew EventSource("/api/runs/1/events");',
      ),
    );
    expect(described(script)).toEqual(["fetch() https://api.example.com/v1"]);
  });

  it("allows plain navigation links, inline data and this origin's own paths", () => {
    const html = scanSource(
      synthetic(
        "html",
        [
          '<a href="https://github.com/tkz96/x-factory/pull/12">Pull request 12</a>',
          '<a href="https://dev.azure.com/org/project">Tracker</a>',
          '<a href="/reference">API Reference</a>',
          '<link rel="icon" href="/favicon.svg">',
          '<script src="/assets/api-reference/scalar-api-reference.min.js"></script>',
          "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E\">",
          '<use href="/assets/icons/sprite.svg#icon-play"></use>',
        ].join("\n"),
      ),
    );
    expect(html).toEqual([]);

    const tsx = scanSource(
      synthetic(
        "script",
        '<a href="https://example.invalid/run/1" rel="noreferrer">the pull request</a>',
      ),
    );
    expect(tsx).toEqual([]);
  });

  it("finds no such reference in any page, stylesheet or frontend module", () => {
    const sources = defaultSources(ROOT_DIR);
    expect(sources.map((s) => s.file)).toContain("index.html");
    expect(sources.map((s) => s.file)).toContain("public/reference.html");
    expect(sources.map((s) => s.file)).toContain("public/styles.css");
    expect(sources.length).toBeGreaterThan(50);

    const findings = scanSources(sources);
    expect(
      findings.map((f) => `${f.file}:${f.line} ${f.reason} ${f.url}`),
    ).toEqual([]);
  });

  it("serves the API Reference from a pinned viewer in this repository", async () => {
    const assetDir = path.join(ROOT_DIR, "public", "assets", "api-reference");
    const reference = await Bun.file(
      path.join(ROOT_DIR, "public/reference.html"),
    ).text();

    expect(reference).toContain(
      'src="/assets/api-reference/scalar-api-reference.min.js"',
    );
    expect(reference).not.toMatch(/https?:\/\//);
    // The pinned Scalar build would otherwise fetch its web fonts from
    // fonts.scalar.com, which is a third-party host.
    expect(reference).toContain('"withDefaultFonts": false');

    // The bytes we serve are the bytes the pin names, so this and `bun run
    // vendor:api-reference --check` agree about what is on disk.
    const provenance = (await Bun.file(
      path.join(assetDir, "provenance.json"),
    ).json()) as {
      package: string;
      version: string;
      integrity: string;
      vendoredSha256: string;
    };
    const vendored = new Uint8Array(
      await Bun.file(
        path.join(assetDir, "scalar-api-reference.min.js"),
      ).arrayBuffer(),
    );
    expect(provenance.package).toBe("@scalar/api-reference");
    expect(provenance.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(provenance.integrity.startsWith("sha512-")).toBe(true);
    expect(new Bun.CryptoHasher("sha256").update(vendored).digest("hex")).toBe(
      provenance.vendoredSha256,
    );
  });
});
