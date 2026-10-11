// test/list-error-empty-states.test.tsx — Runs shows load errors with Retry,
// Queue with zero projects points to onboarding (never an endless spinner),
// and empty states have a readable measure plus a CTA icon (#243, spec #241).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { QueueView } from "../src/frontend/views/QueueView.js";
import { RunsView } from "../src/frontend/views/RunsView.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderView(ui: React.ReactElement, client: QueryClient) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ModalProvider,
        null,
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ProjectProvider, null, ui),
        ),
      ),
    ),
  );
}

describe("RunsView — load failure", () => {
  it("shows an error with a Retry action when the runs request fails", async () => {
    const client = makeClient();
    client.setQueryDefaults(queryKeys.runs(), {
      queryFn: () => {
        throw new Error("raw server body");
      },
    });
    const { container } = renderView(React.createElement(RunsView), client);

    await waitFor(() => {
      if (!container.querySelector(".async-region--error")) {
        throw new Error("error region missing");
      }
    });
    expect(container.querySelector("button.retry-action")).not.toBeNull();
    expect(container.textContent).not.toContain("raw server body");
    expect(container.textContent).not.toContain("No Active Factory Run");
  });
});

describe("QueueView — zero projects", () => {
  it("shows an empty state that points to adding a project, not a spinner", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.projects(), []);
    const { container } = renderView(React.createElement(QueueView), client);

    expect(container.querySelector(".async-region--loading")).toBeNull();
    const empty = container.querySelector(".async-region--empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("Add a project");
    expect(empty?.querySelector("button svg.icon")).not.toBeNull();
  });
});

describe("empty state layout", () => {
  it("centres the empty state and caps its text at a readable measure", async () => {
    const css = await Bun.file(
      `${import.meta.dir}/../src/frontend/components/feedback/AsyncRegion.css`,
    ).text();
    const hint = /\.async-region-hint\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(hint).toContain("max-width: 36ch");
    expect(hint).toContain("text-wrap: balance");
    expect(css).toMatch(/\.async-region--empty\s*\{[^}]*text-align: center/);
  });

  it("gives the Runs standby CTA an icon", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.runs(), []);
    const { container } = renderView(React.createElement(RunsView), client);
    // The CTA is a link to Tickets (#258), styled as a button, with its icon.
    expect(
      container.querySelector(".async-region--empty a svg.icon"),
    ).not.toBeNull();
    expect(container.textContent).toContain("No runs are working right now");
  });
});
