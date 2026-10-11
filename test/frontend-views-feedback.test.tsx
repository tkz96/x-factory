// test/frontend-views-feedback.test.tsx — Per-state behavioral coverage for the
// two read regions migrated off EmptyStateCard (#136): ProjectsView and
// HistoryView now render loading / error / empty / ready through the feedback
// family (AsyncRegion + copy map + RetryAction), per the state-coverage
// contract in docs/reference/state-coverage.md.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { ProjectsView } from "../src/frontend/views/ProjectsView.js";
import { RunsView } from "../src/frontend/views/RunsView.js";

type Project = Parameters<
  typeof import("../src/frontend/components/projects/ProjectCard.js").ProjectCard
>[0]["project"];

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderView(ui: React.ReactElement, client: QueryClient, path = "/") {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ModalProvider,
        null,
        React.createElement(MemoryRouter, { initialEntries: [path] }, ui),
      ),
    ),
  );
}

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "X-Factory Core",
    repositoryPath: "/path/to/repo",
    defaultBranch: "main",
    testCommand: "bun test",
    repositories: [],
    issueTracker: {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/org", project: "proj" },
    },
    ...overrides,
  } as Project;
}

function makeRun(status: string) {
  return {
    id: "run-123",
    project: { id: "proj-1", name: "X-Factory Core" },
    ticket: {
      id: "TICK-42",
      title: "Fix frontend smoke test",
      url: "https://ticket.url",
      acceptanceCriteria: ["All tests pass"],
    },
    branch: "xf-tick-42",
    status,
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
  } as Parameters<
    typeof import("../src/frontend/components/history/RunHistoryCard.js").RunHistoryCard
  >[0]["run"];
}

describe("ProjectsView — feedback-family read region", () => {
  it("renders loading as the reserved spinner region while the query is pending", () => {
    const client = makeClient();
    client.setQueryDefaults(queryKeys.projects(), {
      queryFn: () => new Promise(() => {}),
    });
    const { container } = renderView(React.createElement(ProjectsView), client);

    expect(container.querySelector(".async-region--loading")).not.toBeNull();
    expect(container.textContent).toContain("Loading…");
  });

  it("renders a primary error with canonical copy, a retry, and never the raw payload", async () => {
    const client = makeClient();
    client.setQueryDefaults(queryKeys.projects(), {
      queryFn: () => {
        throw new Error("raw provider body");
      },
    });
    const { container } = renderView(React.createElement(ProjectsView), client);

    await waitFor(
      () => {
        if (
          !container.textContent?.includes("The request failed. Try again.")
        ) {
          throw new Error("canonical error copy missing");
        }
      },
      { timeout: 4000, interval: 100 },
    );
    expect(container.textContent).not.toContain("raw provider body");
    expect(container.querySelector("button.retry-action")).not.toBeNull();
  });

  it("renders the empty active tab with guidance and the onboard call-to-action", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.projects(), []);
    const { container } = renderView(React.createElement(ProjectsView), client);

    expect(container.querySelector(".async-region--empty")).not.toBeNull();
    expect(container.textContent).toContain(
      "Click Onboard Project to connect a workspace repository.",
    );
    const cta = Array.from(container.querySelectorAll("button")).find((b) =>
      b.closest(".async-region--empty"),
    );
    expect(cta?.textContent).toContain("Onboard Project");
  });

  it("renders the empty archived tab with guidance and no call-to-action", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.projects(), [
      makeProject({ id: "proj-active", archived: false }),
    ]);
    const { container } = renderView(React.createElement(ProjectsView), client);

    const archivedTab = container.querySelector("#btn-toggle-archived");
    if (!(archivedTab instanceof HTMLElement)) {
      throw new Error("archived tab button missing");
    }
    fireEvent.click(archivedTab);

    expect(container.querySelector(".async-region--empty")).not.toBeNull();
    expect(container.textContent).toContain("No archived projects found.");
    expect(
      container.querySelector(".async-region--empty .async-region-actions"),
    ).toBeNull();
  });

  it("renders ready content with no feedback chrome", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.projects(), [
      makeProject({
        id: "proj-active",
        name: "Ready Project",
        archived: false,
      }),
      makeProject({ id: "proj-archived", archived: true }),
    ]);
    const { container } = renderView(React.createElement(ProjectsView), client);

    expect(container.querySelector("#projects-container")).not.toBeNull();
    expect(container.textContent).toContain("Ready Project");
    expect(container.querySelector(".async-region--empty")).toBeNull();
    expect(container.querySelector(".async-region--loading")).toBeNull();
  });
});

describe("Runs — feedback-family read region (#258, formerly History)", () => {
  const DONE = "/runs?filter=done";

  it("renders loading as the reserved spinner region while the query is pending", () => {
    const client = makeClient();
    client.setQueryDefaults(queryKeys.runs(), {
      queryFn: () => new Promise(() => {}),
    });
    const { container } = renderView(
      React.createElement(RunsView),
      client,
      DONE,
    );

    expect(container.querySelector(".async-region--loading")).not.toBeNull();
    expect(container.textContent).toContain("Loading…");
  });

  it("renders a primary error with canonical copy, a retry, and never the raw payload", async () => {
    const client = makeClient();
    client.setQueryDefaults(queryKeys.runs(), {
      queryFn: () => {
        throw new Error("raw provider body");
      },
    });
    const { container } = renderView(
      React.createElement(RunsView),
      client,
      DONE,
    );

    await waitFor(
      () => {
        if (
          !container.textContent?.includes("The request failed. Try again.")
        ) {
          throw new Error("canonical error copy missing");
        }
      },
      { timeout: 4000, interval: 100 },
    );
    expect(container.textContent).not.toContain("raw provider body");
    expect(container.querySelector("button.retry-action")).not.toBeNull();
  });

  it("renders true empty for the running list with guidance to start one from Tickets", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.runs(), []);
    const { container } = renderView(
      React.createElement(RunsView),
      client,
      "/runs",
    );

    expect(container.querySelector(".async-region--empty")).not.toBeNull();
    expect(container.textContent).toContain(
      "No runs are working right now. Start one from Tickets.",
    );
    const cta = container.querySelector(
      ".async-region--empty .async-region-actions a",
    );
    expect(cta?.textContent).toContain("Go to Tickets");
  });

  it("renders a filter that matches nothing with filter guidance and no CTA", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.runs(), [makeRun("executing")]);
    const { container } = renderView(
      React.createElement(RunsView),
      client,
      DONE,
    );

    expect(container.querySelector(".async-region--empty")).not.toBeNull();
    expect(container.textContent).toContain("No finished runs yet.");
    expect(
      container.querySelector(".async-region--empty .async-region-actions"),
    ).toBeNull();
  });

  it("renders ready content with no feedback chrome", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.runs(), [makeRun("pr_created")]);
    const { container } = renderView(
      React.createElement(RunsView),
      client,
      DONE,
    );

    expect(container.textContent).toContain("TICK-42");
    expect(container.querySelector(".async-region--empty")).toBeNull();
    expect(container.querySelector(".async-region--loading")).toBeNull();
  });
});
