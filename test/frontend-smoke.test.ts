// test/frontend-smoke.test.ts — React application structure, routing, views, and components smoke tests.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/frontend/App.js";
import { DocsSidebarNav } from "../src/frontend/components/docs/DocsSidebarNav.js";
import { ModalContainer } from "../src/frontend/components/ModalContainer.js";
import { ReadinessBanner } from "../src/frontend/components/projects/ReadinessBanner.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { DiffModal } from "../src/frontend/components/runs/DiffModal.js";
import { RunCheckpointBar } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { RunInspector } from "../src/frontend/components/runs/RunInspector.js";
import {
  defaultOpenStages,
  RunStageTimeline,
} from "../src/frontend/components/runs/RunStageTimeline.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { groupItemsByStage } from "../src/frontend/lib/run-stages.js";
import { routeDefinitions, router } from "../src/frontend/routes.js";
import { DocsView } from "../src/frontend/views/DocsView.js";
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
      // The pre-redesign public/styles.css is retired (#248): the bundled
      // design system is the only stylesheet the shell loads.
      expect(html).not.toContain('href="/styles.css"');
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
      expect(paths).toContain("tickets");
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

    it("RunsView and RunDetailView export functional components", () => {
      expect(typeof RunsView).toBe("function");
      expect(typeof RunDetailView).toBe("function");
    });
  });

  describe("Critical Components", () => {
    // The shell's toolbar, sections, Help and one-h1 behaviour are asserted by
    // behaviour in test/app-shell.test.tsx (#258). The Projects screens — the
    // list, its rows and the detail pane — are asserted by behaviour in
    // test/projects-split.test.tsx (#267); the markup assertions that used to
    // stand here pinned class names and ids the ticket replaced.

    it("DocsSidebarNav exports functional component", () => {
      expect(typeof DocsSidebarNav).toBe("function");
    });

    it("ChatThread exports a functional component", () => {
      expect(typeof ChatThread).toBe("function");
    });

    it("DiffModal renders its file and line counts (the run chat's behaviour is in run-chat-view)", () => {
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

    it("RunStageTimeline renders the six stages, the current one open", () => {
      const groups = groupItemsByStage([], { status: "executing" }, []);
      const html = renderToString(
        React.createElement(RunStageTimeline, {
          groups,
          open: defaultOpenStages(groups),
          onToggle: () => undefined,
          now: Date.parse("2026-10-20T12:00:00.000Z"),
          onOpenFile: () => undefined,
          waiting: false,
        }),
      );

      expect(html).toContain("run-stage-list");
      expect(html).toContain("Prepare");
      expect(html).toContain("Understand");
      expect(html).toContain("Plan");
      // The stage is named for what it does: Code, not Execute (#262).
      expect(html).toContain("Code");
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

    it("RunInspector renders the verification and review evidence in its Evidence section", () => {
      const mockRun = {
        id: "run-smoke-1",
        project: { id: "p1", name: "Smoke Proj" },
        ticket: { id: "T-1", title: "Smoke Ticket", acceptanceCriteria: [] },
        plan: "plan",
        branch: "factory/smoke",
        status: "awaiting_review" as const,
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
        React.createElement(RunInspector, {
          run: mockRun,
          events: [],
          connected: false,
        }),
      );
      // The Evidence section names what it checks; the reviewer is named, not "Session B" (#278).
      expect(html).toContain("Evidence");
      expect(html).toContain("Tests");
      expect(html).toContain("Review");
      expect(html).toContain("Awaiting");
    });

    it("the checkpoint bar offers the policy's actions by name, and Create Pull Request only at delivery", () => {
      const bar = (status: "awaiting_review" | "ready_for_pr" | "pr_created") =>
        renderWithProviders(
          React.createElement(RunCheckpointBar, {
            status,
            pending: null,
            conflict: false,
            onAction: () => {},
          }),
        );
      expect(bar("awaiting_review")).toContain("Approve Changes");
      expect(bar("awaiting_review")).toContain("Request Changes");
      expect(bar("awaiting_review")).not.toContain("Create Pull Request");
      expect(bar("ready_for_pr")).toContain("Create Pull Request");
      expect(bar("pr_created")).not.toContain("Create Pull Request");
      expect(bar("pr_created")).toContain("Start New Run");
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
      expect(indexCss).toContain("./shared/forms.css");
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
  const TOAST_PATTERN_NAME = "toast system";
  /** The one exception to the toast ban: the notification center (#264). */
  const NOTIFICATION_CENTER_DIR_RELATIVE =
    "src/frontend/components/notifications/";
  const ANTI_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
    { name: "ad-hoc spinner markup", pattern: /className="[^"]*spinner/i },
    { name: "ad-hoc generic error copy", pattern: /something went wrong/i },
    { name: TOAST_PATTERN_NAME, pattern: /\btoast\b/i },
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
      const inNotificationCenter = relative.startsWith(
        NOTIFICATION_CENTER_DIR_RELATIVE,
      );
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const { name, pattern } of ANTI_PATTERNS) {
          // The notification center is the one named exception to the toast ban
          // (#264, spec #241): it is a list the user opens, not a floating message.
          if (inNotificationCenter && name === TOAST_PATTERN_NAME) continue;
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

  it("a rule with --radius-full must set corner-shape: round", () => {
    // Continuous corners (superellipse) squash a circle or a capsule into a
    // rounded square, so every --radius-full shape opts back out to a round
    // corner — circles stay circles and capsules keep the SwiftUI Capsule look.
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (match[1] ?? "").trim().replace(/\s+/g, " ");
        const body = match[2] ?? "";
        if (selector === "" || selector.startsWith("@")) continue;
        if (!/var\(\s*--radius-full\s*\)/.test(body)) continue;
        if (!/corner-shape\s*:\s*round\b/.test(body)) {
          violations.push(`${file}: ${selector}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── Foundations gates (spec #292, step 1) ─────────────────────────────────

/** The values of one property in a stylesheet, comments removed and whitespace collapsed. */
function declarationValues(css: string, property: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;{}]*)`, "g");
  return [...stripped.matchAll(pattern)].map((m) =>
    (m[1] ?? "").replace(/\s+/g, " ").trim(),
  );
}

/**
 * G1: a box-shadow or border-radius value is built only from tokens: var(--x),
 * calc() of tokens (an inner radius is the outer one minus the inset), or none.
 * Once the tokens are removed, nothing may be left but operators and brackets.
 */
function isTokenShapeValue(value: string): boolean {
  if (value === "none") return true;
  const rest = value
    .replace(/calc\(/g, "(")
    .replace(/var\(\s*--[a-zA-Z0-9_-]+\s*\)/g, "")
    .replace(/\s+/g, "");
  return /^[(),+\-*/]*$/.test(rest) && /var\(/.test(value);
}

function rawShapeDeclarations(css: string): string[] {
  return ["box-shadow", "border-radius"].flatMap((property) =>
    declarationValues(css, property)
      .filter((value) => !isTokenShapeValue(value))
      .map((value) => `${property}: ${value}`),
  );
}

/** G2: no text token is smaller than 10px (the root is 16px, so rem * 16). */
const MIN_TEXT_TOKEN_PX = 10;
const REMOVED_TEXT_TOKENS = ["--text-micro", "--text-badge", "--text-tag"];

function undersizedTextTokens(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const m of stripped.matchAll(
    /(--text-[a-zA-Z0-9-]+)\s*:\s*([0-9.]+)(px|rem)\s*;/g,
  )) {
    const px = Number(m[2]) * (m[3] === "rem" ? 16 : 1);
    if (px < MIN_TEXT_TOKEN_PX) out.push(`${m[1]}: ${m[2]}${m[3]}`);
  }
  return out;
}

describe("Frontend Smoke — Foundations gates G1 and G2 (spec #292)", () => {
  function frontendStylesheets(): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".css")) {
          out.push({
            file: path.relative(ROOT_DIR, full),
            text: fs.readFileSync(full, "utf-8"),
          });
        }
      }
    };
    walk(path.join(ROOT_DIR, "src/frontend"));
    return out;
  }

  const stylesheets = frontendStylesheets();
  const outsideTokens = stylesheets.filter(
    ({ file }) => !file.endsWith("tokens.css"),
  );

  it("G1: no raw box-shadow or border-radius value outside tokens.css", () => {
    const violations = outsideTokens.flatMap(({ file, text }) =>
      rawShapeDeclarations(text).map((value) => `${file}: ${value}`),
    );
    expect(violations).toEqual([]);
  });

  it("G1 fails on a raw shadow or radius, and passes tokens and none (fixture)", () => {
    expect(
      rawShapeDeclarations(
        ".card { box-shadow: 0 1px 2px red; border-radius: 4px; }",
      ),
    ).toEqual(["box-shadow: 0 1px 2px red", "border-radius: 4px"]);
    expect(
      rawShapeDeclarations(
        ".ok {\n  box-shadow:\n    var(--shadow-sm);\n  border-radius: var(--radius-card);\n  border-radius: calc(var(--radius-md) - var(--space-1));\n}\n.none { box-shadow: none; }",
      ),
    ).toEqual([]);
    expect(
      rawShapeDeclarations(
        ".edge { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }",
      ),
    ).toEqual(["border-radius: 0 var(--radius-sm) var(--radius-sm) 0"]);
  });

  it("G2: no text token is smaller than 10px, and the off-scale tokens are gone", () => {
    const tokens = stylesheets.find(({ file }) =>
      file.endsWith("tokens.css"),
    )?.text;
    expect(tokens).toBeDefined();
    expect(undersizedTextTokens(tokens ?? "")).toEqual([]);
    const uses = stylesheets.flatMap(({ file, text }) =>
      REMOVED_TEXT_TOKENS.filter((name) => text.includes(name)).map(
        (name) => `${file}: ${name}`,
      ),
    );
    expect(uses).toEqual([]);
  });

  it("G2 fails on a token below 10px and on a removed token (fixture)", () => {
    expect(
      undersizedTextTokens(
        ":root { --text-micro: 9px; --text-caption-1: 0.625rem; --text-footnote: 0.5rem; }",
      ),
    ).toEqual(["--text-micro: 9px", "--text-footnote: 0.5rem"]);
    expect(
      REMOVED_TEXT_TOKENS.filter((name) =>
        ".x { font-size: var(--text-tag); }".includes(name),
      ),
    ).toEqual(["--text-tag"]);
  });
});

// ─── Migration gates G3–G9 and G11 (spec #292, "Gates") ─────────────────────

/** Every file under src/frontend with one of the given extensions, as text. */
function frontendFiles(exts: string[]): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push({
          file: path.relative(ROOT_DIR, full),
          text: fs.readFileSync(full, "utf-8"),
        });
      }
    }
  };
  walk(path.join(ROOT_DIR, "src/frontend"));
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every rule as its selector and body, innermost rules first (media wrappers are skipped). */
function cssRules(css: string): { selector: string; body: string }[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? "",
  }));
}

/** Declarations of one property in a body, as their values. */
function bodyValues(body: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]*)`, "g");
  return [...body.matchAll(pattern)].map((m) =>
    (m[1] ?? "").replace(/\s+/g, " ").trim(),
  );
}

const SPACING_PROPERTIES =
  "(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-[a-z-]+)?";

/** G3: a margin, padding, gap, inset or offset value never uses rem or em. */
function rawSpacingDeclarations(css: string): string[] {
  const pattern = new RegExp(
    `(?:^|[;{\\s])(${SPACING_PROPERTIES})\\s*:\\s*([^;{}]*)`,
    "g",
  );
  return [...stripComments(css).matchAll(pattern)]
    .filter((m) => /(?<![\w-])\d*\.?\d+r?em\b/.test(m[2] ?? ""))
    .map((m) => `${m[1]}: ${(m[2] ?? "").trim()}`);
}

/** G4: text is set by text styles. Only the four shared text files may name a text token. */
const TEXT_STYLE_FILES = [
  "src/frontend/styles/utilities.css",
  "src/frontend/styles/shared/controls.css",
  "src/frontend/styles/shared/forms.css",
  "src/frontend/styles/base.css",
];

function fontViolations(file: string, css: string): string[] {
  const out: string[] = [];
  const exempt = TEXT_STYLE_FILES.includes(file);
  for (const { selector, body } of cssRules(css)) {
    for (const property of ["font-size", "font-weight"]) {
      for (const value of bodyValues(body, property)) {
        if (!exempt) {
          out.push(`${file}: ${property}: ${value}`);
        } else if (file.endsWith("base.css") && selector !== "html") {
          out.push(`${file}: ${property} outside the html root rule`);
        } else if (
          property === "font-size" &&
          !/^var\(--text-[a-z0-9-]+\)$/.test(value)
        ) {
          out.push(`${file}: font-size is not a text token: ${value}`);
        } else if (
          property === "font-weight" &&
          !/^var\(--(?:font-weight|text)-[a-z0-9-]+\)$/.test(value)
        ) {
          out.push(`${file}: font-weight is not a weight token: ${value}`);
        }
      }
    }
  }
  return out;
}

/** G9: a card class is the Card block's; a diagram node card is the one exception. */
function isCardClassName(name: string): boolean {
  if (name.startsWith("ui-") || name === "flow-node-card") return false;
  return name === "card" || name.endsWith("-card");
}

function cardClassesInCss(css: string): string[] {
  return [...stripComments(css).matchAll(/\.([a-zA-Z0-9_-]+)/g)]
    .map((m) => m[1] ?? "")
    .filter(isCardClassName);
}

function cardClassesInTsx(tsx: string): string[] {
  const literals = [...tsx.matchAll(/className=\{?(["`])([^"`]*)\1/g)].map(
    (m) => m[2] ?? "",
  );
  return literals.flatMap((text) => text.split(/\s+/).filter(isCardClassName));
}

/** G5 and G6: a raw button, or a direct sprite path, lives only in components/ui. */
function isBlockFile(file: string): boolean {
  return file.startsWith("src/frontend/components/ui/");
}

/** G7: a view renders no page heading of its own; PageHeader carries it. */
const PAGE_HEADING_CLASS =
  /(?:^|[\s"'`])(?:page-heading|page-header|view-header)\b/;

/** G8: empty-state markup is AsyncRegion's or EmptyState's. */
function emptyStateClassNames(tsx: string): string[] {
  return [...tsx.matchAll(/className=\{?(["`])([^"`]*)\1/g)]
    .map((m) => m[2] ?? "")
    .filter((text) => /\bempty/.test(text) && !text.includes("ui-empty-state"));
}

/**
 * G11: a bare `button` element is never a style target: an unqualified type
 * selector (no class, id or attribute on it), in any compound.
 */
const BARE_BUTTON_SELECTOR = /(?:^|[\s,(>+~])button(?![\w.#[-])/;

function bareButtonSelectors(css: string): string[] {
  return cssRules(css)
    .flatMap(({ selector }) => selector.split(/,(?![^(]*\))/))
    .map((part) => part.trim())
    .filter((part) => BARE_BUTTON_SELECTOR.test(part));
}

describe("Frontend Smoke — Migration gates G3 to G9 and G11 (spec #292)", () => {
  const styles = frontendFiles([".css"]).map(({ file, text }) => ({
    file,
    text,
  }));
  const tsx = frontendFiles([".tsx"]);
  const sources = frontendFiles([".ts", ".tsx"]);
  const outsideTokens = styles.filter(
    ({ file }) => !file.endsWith("tokens.css"),
  );

  it("G3: no raw rem or em spacing outside tokens.css", () => {
    const violations = outsideTokens.flatMap(({ file, text }) =>
      rawSpacingDeclarations(text).map((value) => `${file}: ${value}`),
    );
    expect(violations).toEqual([]);
  });

  it("G3 fails on a raw rem or em margin, padding, gap or offset, and passes tokens (fixture)", () => {
    expect(
      rawSpacingDeclarations(
        ".a { padding: 0.5rem 1rem; } .b { inset: 0 auto auto 0.25em; }",
      ),
    ).toEqual(["padding: 0.5rem 1rem", "inset: 0 auto auto 0.25em"]);
    expect(
      rawSpacingDeclarations(
        ".ok { padding: var(--space-2) var(--space-4); gap: calc(var(--space-1) * 2); max-width: 26rem; }",
      ),
    ).toEqual([]);
  });

  it("G4: no font-size or font-weight in a component stylesheet; the text files use tokens only", () => {
    const violations = outsideTokens.flatMap(({ file, text }) =>
      fontViolations(file, text),
    );
    expect(violations).toEqual([]);
  });

  it("G4 fails on a component font declaration and on a literal in a text file (fixture)", () => {
    expect(
      fontViolations(
        "src/frontend/components/x/X.css",
        ".x { font-size: 13px; font-weight: 600; }",
      ),
    ).toEqual([
      "src/frontend/components/x/X.css: font-size: 13px",
      "src/frontend/components/x/X.css: font-weight: 600",
    ]);
    expect(
      fontViolations(
        "src/frontend/styles/utilities.css",
        ".t { font-size: var(--text-body); font-weight: var(--font-weight-semibold); }",
      ),
    ).toEqual([]);
    expect(
      fontViolations(
        "src/frontend/styles/utilities.css",
        ".t { font-weight: 600; }",
      ),
    ).toEqual([
      "src/frontend/styles/utilities.css: font-weight is not a weight token: 600",
    ]);
    expect(
      fontViolations(
        "src/frontend/styles/base.css",
        "html { font-size: var(--text-root); }",
      ),
    ).toEqual([]);
    expect(
      fontViolations(
        "src/frontend/styles/base.css",
        ".x { font-size: var(--text-body); }",
      ),
    ).toEqual([
      "src/frontend/styles/base.css: font-size outside the html root rule",
    ]);
  });

  it("G5: no raw <button> outside components/ui", () => {
    const violations = tsx
      .filter(({ file }) => !isBlockFile(file))
      .flatMap(({ file, text }) => (/<button\b/.test(text) ? [file] : []));
    expect(violations).toEqual([]);
  });

  it("G5 fails on a raw <button> and passes the block (fixture)", () => {
    expect(
      /<button\b/.test('<button type="button" onClick={go}>Go</button>'),
    ).toBe(true);
    expect(
      /<button\b/.test('<Button variant="quiet" onPress={go}>Go</Button>'),
    ).toBe(false);
  });

  it("G6: no sprite.svg# reference outside components/ui", () => {
    const violations = sources
      .filter(({ file }) => !isBlockFile(file))
      .flatMap(({ file, text }) => (/sprite\.svg#/.test(text) ? [file] : []));
    expect(violations).toEqual([]);
  });

  it("G6 fails on a direct sprite path and passes the Icon block (fixture)", () => {
    expect(
      /sprite\.svg#/.test('<use href="/assets/icons/sprite.svg#icon-x" />'),
    ).toBe(true);
    expect(/sprite\.svg#/.test('<Icon name="icon-x" size="sm" />')).toBe(false);
  });

  it("G7: no page <header> or page-heading class in views/*.tsx; PageHeader only", () => {
    const views = tsx.filter(({ file }) =>
      /^src\/frontend\/views\/[^/]+\.tsx$/.test(file),
    );
    const violations = views.flatMap(({ file, text }) => {
      const found: string[] = [];
      if (/<header\b/.test(text)) found.push(`${file}: <header>`);
      if (PAGE_HEADING_CLASS.test(text)) {
        found.push(`${file}: page-heading class`);
      }
      return found;
    });
    expect(violations).toEqual([]);
  });

  it("G7 fails on a view header and on a page-heading class, and passes PageHeader (fixture)", () => {
    expect(/<header\b/.test('<header className="page">')).toBe(true);
    expect(PAGE_HEADING_CLASS.test('<div className="page-heading">')).toBe(
      true,
    );
    expect(PAGE_HEADING_CLASS.test('<PageHeader title="Runs" />')).toBe(false);
  });

  it("G8: no empty-state markup outside AsyncRegion or EmptyState", () => {
    const violations = tsx
      .filter(
        ({ file }) =>
          !isBlockFile(file) && !file.includes("components/feedback/"),
      )
      .flatMap(({ file, text }) =>
        emptyStateClassNames(text).map((name) => `${file}: ${name}`),
      );
    expect(violations).toEqual([]);
  });

  it("G8 fails on a hand-built empty state and passes EmptyState (fixture)", () => {
    expect(emptyStateClassNames('<div className="docs-search-empty">')).toEqual(
      ["docs-search-empty"],
    );
    expect(emptyStateClassNames('<div className="ui-empty-state">')).toEqual(
      [],
    );
  });

  it("G9: no card class outside the Card block, except diagram node cards", () => {
    const violations = [
      ...styles.flatMap(({ file, text }) =>
        cardClassesInCss(text).map((name) => `${file}: .${name}`),
      ),
      ...tsx.flatMap(({ file, text }) =>
        cardClassesInTsx(text).map((name) => `${file}: ${name}`),
      ),
    ];
    expect(violations).toEqual([]);
  });

  it("G9 fails on a card class and passes the Card block and a node card (fixture)", () => {
    expect(
      cardClassesInCss(
        ".connection-card { padding: 1px; } .ui-card--flow {} .flow-node-card {}",
      ),
    ).toEqual(["connection-card"]);
    expect(
      cardClassesInTsx('<div className="ticket-card flow-node-card ui-card">'),
    ).toEqual(["ticket-card"]);
    expect(cardClassesInTsx('<Card variant="ticket">')).toEqual([]);
  });

  it("G11: buttons.css, cards.css and badges.css do not exist, and no stylesheet styles a bare button", () => {
    const legacy = ["buttons.css", "cards.css", "badges.css"].map((name) =>
      path.join(ROOT_DIR, "src/frontend/styles/shared", name),
    );
    expect(legacy.filter((file) => fs.existsSync(file))).toEqual([]);
    const violations = styles.flatMap(({ file, text }) =>
      bareButtonSelectors(text).map((selector) => `${file}: ${selector}`),
    );
    expect(violations).toEqual([]);
  });

  it("G11 fails on a bare button selector and passes the block classes (fixture)", () => {
    expect(
      bareButtonSelectors(
        "button { padding: 0; } :root button:disabled {} .a button {} :is(button, a) {}",
      ),
    ).toEqual([
      "button",
      ":root button:disabled",
      ".a button",
      ":is(button, a)",
    ]);
    expect(
      bareButtonSelectors(
        '.ui-button, .ui-icon-button, [type="button"], button.mobile-only { padding: 0; }',
      ),
    ).toEqual([]);
  });
});

// ─── Copy gate (spec #292, step 5) ─────────────────────────────────────────

describe("Frontend Smoke — Copy gate G10 (spec #292)", () => {
  /**
   * G10: a button or menu-item label is Title Case. Every word is capitalized
   * except an article, a coordinating conjunction or a short preposition, and
   * the first and the last word are always capitalized, even when minor
   * (DESIGN.md §7 Copy; spec #292, "Copy").
   */
  const MINOR_WORDS = new Set([
    "a",
    "an",
    "the",
    "and",
    "but",
    "or",
    "nor",
    "for",
    "so",
    "yet",
    "in",
    "on",
    "at",
    "to",
    "by",
    "with",
    "from",
    "into",
    "onto",
    "of",
    "off",
    "up",
    "down",
    "over",
    "under",
    "about",
    "as",
    "per",
    "via",
    "near",
    "between",
    "during",
    "without",
    "within",
    "against",
    "through",
    "around",
    "after",
    "before",
    "except",
    "like",
    "than",
    "until",
    "upon",
  ]);

  /** The letter-bearing words of a label; symbols and digits carry no case. */
  function wordTokens(label: string): string[] {
    return label.split(/\s+/).filter((token) => /[a-zA-Z]/.test(token));
  }

  /** The words that break Title Case, in order ("changes" from "Save changes"). */
  function titleCaseViolations(label: string): string[] {
    const words = wordTokens(label);
    if (words.length === 0) return [];
    const first = words[0];
    const last = words[words.length - 1];
    const out: string[] = [];
    for (const token of words) {
      const i = token.search(/[a-zA-Z]/);
      const core = token
        .slice(i)
        .replace(/[^a-zA-Z].*$/, "")
        .toLowerCase();
      const minor = MINOR_WORDS.has(core);
      const shouldCapitalize = token === first || token === last || !minor;
      const letter = token[i] ?? "";
      const capitalized = letter === letter.toUpperCase();
      if (shouldCapitalize !== capitalized) out.push(token);
    }
    return out;
  }

  /** The index of the `>` that ends a JSX opening tag, skipping `>` inside `{...}`. */
  function tagEnd(text: string, from: number): number {
    let depth = 0;
    let quote = "";
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) return i;
    }
    return text.length;
  }

  /** The visible label of one element's children: tags and expressions dropped. */
  function innerLabel(inner: string): string {
    let out = inner.replace(/<[^>]*>/g, " ");
    for (let i = 0; i < 6; i++) out = out.replace(/\{[^{}]*\}/g, " ");
    return out.replace(/\s+/g, " ").trim();
  }

  /** Every literal button and menu-item label written in one TSX source. */
  function actionLabels(text: string): string[] {
    const labels: string[] = [];
    for (const name of ["Button", "MenuItem"]) {
      const open = new RegExp(`<${name}(?=[\\s/>])`, "g");
      for (const match of text.matchAll(open)) {
        const start = match.index ?? 0;
        const end = tagEnd(text, start + 1 + name.length);
        if (text[end - 1] === "/") continue; // self-closing, no label
        const close = text.indexOf(`</${name}>`, end);
        if (close === -1) continue;
        const inner = text.slice(end + 1, close);
        // A dynamic label (an expression, a count, sr-only text) is not a
        // literal this static gate can judge; it is asserted where it renders.
        if (inner.includes("{")) continue;
        const label = innerLabel(inner);
        if (label && /[A-Za-z]/.test(label)) labels.push(label);
      }
    }
    for (const match of text.matchAll(/<IconButton\b/g)) {
      const start = match.index ?? 0;
      const tag = text.slice(start, tagEnd(text, start + 11) + 1);
      const label = tag.match(/\blabel="([^"]+)"/)?.[1];
      if (label) labels.push(label);
    }
    return labels;
  }

  function frontendTsx(): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) {
          out.push({
            file: path.relative(ROOT_DIR, full),
            text: fs.readFileSync(full, "utf-8"),
          });
        }
      }
    };
    walk(path.join(ROOT_DIR, "src/frontend"));
    return out;
  }

  it("G10: button and menu-item labels use Title Case", () => {
    const violations = frontendTsx().flatMap(({ file, text }) =>
      actionLabels(text)
        .filter((label) => titleCaseViolations(label).length > 0)
        .map((label) => `${file}: ${label}`),
    );
    expect(violations).toEqual([]);
  });

  it("G10 flags sentence-case labels and passes Title Case, keeping the ellipsis (fixture)", () => {
    expect(titleCaseViolations("Save changes")).toEqual(["changes"]);
    expect(titleCaseViolations("Open dialog…")).toEqual(["dialog…"]);
    expect(titleCaseViolations("Jump to latest")).toEqual(["latest"]);
    expect(titleCaseViolations("Clear search query")).toEqual([
      "search",
      "query",
    ]);
    expect(titleCaseViolations("Save Changes")).toEqual([]);
    expect(titleCaseViolations("Open Dialog…")).toEqual([]);
    expect(titleCaseViolations("Jump to Latest")).toEqual([]);
    expect(titleCaseViolations("Mark All as Read")).toEqual([]);
    expect(titleCaseViolations("Clear Search Query")).toEqual([]);

    // The extractor pulls a bad label out of a real JSX snippet — including one
    // whose opening tag hides `>` inside an arrow function — so the gate
    // provably fails on a sentence-case button and menu item.
    const bad = actionLabels(
      '<Button variant="primary" onPress={() => go()}>Save changes</Button>' +
        '<MenuItem id="m" isDanger onAction={stop}>Stop run</MenuItem>' +
        '<IconButton label="Clear search query" icon="icon-x" />',
    );
    expect(bad).toEqual(["Save changes", "Stop run", "Clear search query"]);
    expect(bad.flatMap((label) => titleCaseViolations(label))).toEqual([
      "changes",
      "run",
      "search",
      "query",
    ]);

    const good = actionLabels(
      '<Button variant="primary">Save Changes</Button>' +
        '<MenuItem id="m">Open Run</MenuItem>' +
        '<IconButton label="Send" icon="icon-send" />',
    );
    expect(good.flatMap((label) => titleCaseViolations(label))).toEqual([]);
  });
});

// ─── Motion system (spec #241, ticket #252) ────────────────────────────────

describe("Frontend Smoke — Motion (#252)", () => {
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
  const sources = listFiles(frontendDir, [".css", ".ts", ".tsx"]).map(
    (file) => ({
      file: path.relative(ROOT_DIR, file),
      css: file.endsWith(".css"),
      text: fs.readFileSync(file, "utf-8").replace(/\/\*[\s\S]*?\*\//g, ""),
    }),
  );

  /** The index of the `}` that closes the block whose `{` is at `openBrace`. */
  function blockEnd(text: string, openBrace: number): number {
    let depth = 1;
    for (let i = openBrace + 1; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return text.length;
  }

  /** Character ranges of every `@media (prefers-reduced-motion: reduce)` block. */
  function reducedMotionBlocks(text: string): { start: number; end: number }[] {
    const blocks: { start: number; end: number }[] = [];
    const media = /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/gi;
    for (const match of text.matchAll(media)) {
      const openBrace = (match.index ?? 0) + match[0].length - 1;
      blocks.push({ start: openBrace, end: blockEnd(text, openBrace) });
    }
    return blocks;
  }

  function insideAny(
    blocks: { start: number; end: number }[],
    index: number,
  ): boolean {
    return blocks.some((block) => index > block.start && index < block.end);
  }

  function keyframes(text: string) {
    const blocks = reducedMotionBlocks(text);
    return text
      .matchAll(/@keyframes\s+([\w-]+)\s*\{/g)
      .map((match) => {
        const openBrace = (match.index ?? 0) + match[0].length - 1;
        return {
          name: match[1] ?? "",
          body: text.slice(openBrace + 1, blockEnd(text, openBrace)),
          reduced: insideAny(blocks, match.index ?? 0),
        };
      })
      .toArray();
  }

  function styleRules(text: string) {
    const blocks = reducedMotionBlocks(text);
    return text
      .matchAll(/([^{}]*)\{/g)
      .map((match) => {
        const prelude = (match[1] ?? "").trim().replace(/\s+/g, " ");
        const openBrace = (match.index ?? 0) + match[0].length - 1;
        return {
          selector: prelude,
          body: text.slice(openBrace + 1, blockEnd(text, openBrace)),
          reduced: insideAny(blocks, match.index ?? 0),
        };
      })
      .filter((rule) => rule.selector !== "" && !rule.selector.startsWith("@"))
      .toArray();
  }

  /**
   * Properties that make something travel, resize or shift. `transform: none`
   * is the identity, so a reduced path may state it; anything else moves.
   */
  const MOVEMENT_DECLARATION =
    /(?:^|[;{}])\s*(?:transform|translate|rotate|scale|top|right|bottom|left|inset|width|height|margin|padding)(?:-[\w-]+)?\s*:\s*([^;}]*)/g;

  function animatesMovement(body: string): boolean {
    for (const match of body.matchAll(MOVEMENT_DECLARATION)) {
      const value = (match[1] ?? "").trim();
      if (value === "none" || value === "0") continue;
      return true;
    }
    return false;
  }

  it("every keyframe that moves has a reduced-motion path that does not", () => {
    const problems: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      const frames = keyframes(text);
      const reducedFrames = frames.filter((frame) => frame.reduced);
      for (const frame of frames) {
        if (frame.reduced) {
          if (animatesMovement(frame.body)) {
            problems.push(
              `${file}: @keyframes ${frame.name} still moves in its reduced path`,
            );
          }
          continue;
        }
        if (!animatesMovement(frame.body)) continue;
        if (!reducedFrames.some((reduced) => reduced.name === frame.name)) {
          problems.push(
            `${file}: @keyframes ${frame.name} moves and has no reduced-motion path`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every infinite animation stops under reduced motion (#252)", () => {
    const problems: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      const rules = styleRules(text);
      const stopped = new Set(
        rules
          .filter(
            (rule) =>
              rule.reduced &&
              /animation-iteration-count\s*:\s*1\b|animation\s*:\s*none\b/.test(
                rule.body,
              ),
          )
          .map((rule) => rule.selector),
      );
      for (const rule of rules) {
        if (rule.reduced) continue;
        if (!/animation[^;}]*\binfinite\b/.test(rule.body)) continue;
        if (!stopped.has(rule.selector)) {
          problems.push(
            `${file}: ${rule.selector} loops forever with no reduced-motion path`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("no raw duration or easing literal outside token files (#252)", () => {
    const MOTION_DECLARATION =
      /(?:^|[;{}])\s*(transition|animation)(-duration|-timing-function|-delay)?\s*:\s*([^;{}]*)/g;
    const TIME_LITERAL = /\b\d*\.?\d+(?:ms|s)\b/;
    const EASING_LITERAL =
      /(?:^|[\s,(])(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps|cubic-bezier)\b(?!-)/;
    const violations: string[] = [];
    for (const { file, text, css } of sources) {
      if (!css) continue;
      if (file.endsWith("tokens.css") || file.includes("tokens/")) continue;
      for (const match of text.matchAll(MOTION_DECLARATION)) {
        const value = (match[3] ?? "").trim();
        if (!TIME_LITERAL.test(value) && !EASING_LITERAL.test(value)) continue;
        violations.push(`${file}: ${match[0].trim().replace(/\s+/g, " ")}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("loads the motion library lazily, and only the features in use (#252)", () => {
    const motionDir = path.join(frontendDir, "motion");
    const motionSources = listFiles(motionDir, [".ts", ".tsx"]).map((file) => ({
      file: path.relative(ROOT_DIR, file),
      text: fs.readFileSync(file, "utf-8"),
    }));

    // The feature pack must reach the browser through a dynamic import: a
    // static one would put it in the entry chunk on every page load.
    const features = motionSources.find((source) =>
      source.file.endsWith("motion-features.ts"),
    );
    expect(features).toBeDefined();
    expect(features?.text).toMatch(
      /import\(\s*["']\.\/motion-feature-pack\.js["']\s*\)/,
    );

    // One file, and only that file, may name a feature pack. Everything else
    // uses `m` components, which is what keeps the pack out of the entry chunk.
    const namingPacks = motionSources
      .filter((source) => /\bdom(?:Max|Animation|Min)\b/.test(source.text))
      .map((source) => source.file);
    expect(namingPacks).toEqual(["src/frontend/motion/motion-feature-pack.ts"]);

    // The library is a local dependency, resolved from the repository, so the
    // app never asks another host for it.
    const resolved = import.meta.resolve("motion/react");
    expect(resolved.startsWith("file://")).toBe(true);
    expect(resolved).toContain("/node_modules/motion/");
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
    expect(sources.map((s) => s.file)).toContain(
      "src/frontend/styles/base.css",
    );
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
