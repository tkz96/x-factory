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

  it("keeps the tab bar on every view, so the reserved space is not docs-only", () => {
    stubFetch();
    const client = new QueryClient();
    render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/runs"] },
          React.createElement(AppShell),
        ),
      ),
    );
    expect(document.getElementById("mobile-tab-bar")).not.toBeNull();
  });
});

describe("Docs phone layout rules (390 px)", () => {
  const css = readFileSync(
    "src/frontend/components/AppShellDocsPhone.css",
    "utf8",
  );
  const phone = css;
  const tokens = readFileSync("src/frontend/styles/tokens.css", "utf8");

  it("keeps the tab bar height in one token, never in a layout", () => {
    for (const file of [
      "src/frontend/components/AppShell.css",
      "src/frontend/components/AppShellDocsPhone.css",
    ]) {
      expect(readFileSync(file, "utf8")).not.toContain("54px");
    }
  });

  it("spaces with --space-* tokens and never a raw length", () => {
    const literals = Array.from(
      phone.matchAll(
        /(?:^|[;{\s])(?:padding|margin|gap)(?:-[\w-]+)?\s*:\s*([^;}]+)/g,
      ),
    ).filter((match) => {
      const value = (match[1] ?? "").replace(/env\([^)]*\)/g, "");
      return /\d*\.?\d+(px|rem)/.test(value);
    });
    expect(literals.map((m) => m[0].trim())).toEqual([]);
  });

  it("reserves the tab bar height from the one token, including the safe area", () => {
    expect(tokens).toMatch(/--tab-bar-height:\s*54px;/);
    expect(phone).toMatch(
      /\.main-content\s*\{[^}]*padding-bottom:\s*calc\(\s*var\(--tab-bar-height\) \+\s*env\(safe-area-inset-bottom, 0px\) \+\s*var\(--space-4\)/,
    );
  });

  it("shows the docs sheet above content but leaves the tab bar visible", () => {
    expect(phone).toMatch(
      /aside\.sidebar\.docs-nav-open\s*\{[^}]*display:\s*flex/,
    );
    expect(phone).toMatch(
      /aside\.sidebar\.docs-nav-open\s*\{[^}]*bottom:\s*calc\(var\(--tab-bar-height\)/,
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
