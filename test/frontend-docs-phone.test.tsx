// test/frontend-docs-phone.test.tsx — Docs usable at phone width (#244, spec #241).
// Behaviour: the docs navigation is reachable through a labelled disclosure
// (the desktop sidebar is hidden at 390 px), choosing a document closes it, and
// the layout rules keep the article clear of the tab bar and the breadcrumb
// readable.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
afterAll(async () => {
  await unregisterHappyDom();
});

const catalog = {
  categories: [
    {
      id: "tutorials",
      name: "Tutorials",
      description: "",
      docs: [
        {
          slug: "first-agent-run",
          title: "First agent run",
          description: "",
          path: "",
        },
        { slug: "second-run", title: "Second run", description: "", path: "" },
      ],
    },
  ],
};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/docs") ? catalog : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function renderShell() {
  stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/docs?cat=tutorials&slug=first-agent-run"] },
        React.createElement(AppShell),
      ),
    ),
  );
}

describe("Docs at phone width", () => {
  it("opens the document list from a labelled toggle and closes it after choosing", async () => {
    const view = renderShell();
    const toggle = view.getByRole("button", { name: /browse documents/i });
    const sidebar = document.getElementById("app-sidebar") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.classList.contains("docs-nav-open")).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.classList.contains("docs-nav-open")).toBe(true);

    const second = await waitFor(() => view.getByTitle("Second run"));
    fireEvent.click(second);
    await waitFor(() =>
      expect(sidebar.classList.contains("docs-nav-open")).toBe(false),
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("can be dismissed with an explicit close control", () => {
    const view = renderShell();
    fireEvent.click(view.getByRole("button", { name: /browse documents/i }));
    fireEvent.click(view.getByRole("button", { name: /close document list/i }));
    expect(
      document
        .getElementById("app-sidebar")
        ?.classList.contains("docs-nav-open"),
    ).toBe(false);
  });

  it("does not offer the toggle outside Docs", () => {
    stubFetch();
    const client = new QueryClient();
    const view = render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/queue"] },
          React.createElement(AppShell),
        ),
      ),
    );
    expect(
      view.queryByRole("button", { name: /browse documents/i }),
    ).toBeNull();
  });
});

describe("Docs phone layout rules (390 px)", () => {
  const css = readFileSync(
    "src/frontend/components/AppShellDocsPhone.css",
    "utf8",
  );
  const phone = css;

  it("reserves the full tab bar height including the safe area under the content", () => {
    expect(phone).toMatch(
      /\.main-content\s*\{[^}]*padding-bottom:\s*calc\(\s*54px \+\s*env\(safe-area-inset-bottom, 0px\) \+\s*var\(--space-4\)/,
    );
  });

  it("shows the docs sheet above content but leaves the tab bar visible", () => {
    expect(phone).toMatch(
      /aside\.sidebar\.docs-nav-open\s*\{[^}]*display:\s*flex/,
    );
    expect(phone).toMatch(
      /aside\.sidebar\.docs-nav-open\s*\{[^}]*bottom:\s*calc\(54px/,
    );
  });

  it("lets the breadcrumb wrap instead of truncating", () => {
    expect(phone).toMatch(
      /\.docs-header-crumb-trail\s*\{[^}]*flex-wrap:\s*wrap/,
    );
    expect(phone).toMatch(
      /\.docs-header-crumb-current\s*\{[^}]*white-space:\s*normal/,
    );
    expect(phone).toMatch(
      /\.docs-header-crumb-current\s*\{[^}]*max-width:\s*none/,
    );
  });
});
