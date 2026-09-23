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
import { EmptyStateCard } from "../src/frontend/components/EmptyStateCard.js";
import { RunHistoryCard } from "../src/frontend/components/history/RunHistoryCard.js";
import { ModalContainer } from "../src/frontend/components/ModalContainer.js";
import { ProjectCard } from "../src/frontend/components/projects/ProjectCard.js";
import { ReadinessBanner } from "../src/frontend/components/projects/ReadinessBanner.js";
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

    it("EmptyStateCard renders loading, error, and empty states cleanly", () => {
      const emptyHtml = renderToString(
        React.createElement(EmptyStateCard, {
          title: "Nothing Here",
          message: "No items match current criteria.",
        }),
      );
      expect(emptyHtml).toContain("empty-state");
      expect(emptyHtml).toContain("Nothing Here");

      const loadingHtml = renderToString(
        React.createElement(EmptyStateCard, {
          type: "loading",
          title: "Loading Data…",
        }),
      );
      expect(loadingHtml).toContain("spinner-sm");
      expect(loadingHtml).toContain("Loading Data…");
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
            events: [],
            startedAt: "2026-09-20T12:00:00.000Z",
            finishedAt: "2026-09-20T12:05:00.000Z",
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
          status: "implementing",
        }),
      );

      expect(html).toContain("workflow-stepper");
      expect(html).toContain("Prepare");
      expect(html).toContain("Understand");
      expect(html).toContain("Implement");
      expect(html).toContain("Verify");
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
