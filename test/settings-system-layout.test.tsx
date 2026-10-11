// test/settings-system-layout.test.tsx — Settings in the System Settings layout (#266, spec #241).
//
// A category list beside a detail pane; at phone width a category pushes its
// pane and the pane has a way back. Asserted by what a user can reach and read:
// roles, names, links and the current category, never class names or ids.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { setTheme } from "../src/frontend/hooks/useTheme.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function renderSettings(initialEntry = "/settings") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        createElement(ModalProvider, null, createElement(SettingsView)),
      ),
    ),
  );
}

afterAll(async () => {
  await unregisterHappyDom();
});

describe("Settings in the System Settings layout (#266)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          jsonResponse({ theme: "default", appearance: "automatic" }),
        );
      }
      if (url.includes("/api/projects")) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse({ error: "unreachable" }, 500));
    }) as typeof fetch;
    act(() => setTheme("default"));
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    act(() => setTheme("default"));
  });

  it("lists every category as a link in one navigation region", () => {
    const { getByRole } = renderSettings();

    const nav = getByRole("navigation", { name: "Settings categories" });
    for (const name of [
      "General",
      "Connections",
      "Models",
      "Git",
      "Diagnostics",
      "Help",
    ]) {
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    }
  });

  it("opens General first and marks it as the current category", () => {
    const { getByRole } = renderSettings();

    expect(
      getByRole("link", { name: "General" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      getByRole("link", { name: "Help" }).getAttribute("aria-current"),
    ).toBe(null);
    expect(getByRole("heading", { name: "General" })).toBeTruthy();
  });

  it("opens a category's pane when its link is chosen, and moves the current mark", async () => {
    const { getByRole, queryByRole } = renderSettings();

    fireEvent.click(getByRole("link", { name: "Help" }));

    await waitFor(() => {
      expect(getByRole("heading", { name: "Help" })).toBeTruthy();
    });
    expect(
      getByRole("link", { name: "Help" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      getByRole("link", { name: "General" }).getAttribute("aria-current"),
    ).toBe(null);
    expect(queryByRole("switch", { name: "Desktop notifications" })).toBeNull();
  });

  it("reaches Documentation and the API Reference from the Help pane", () => {
    const { getByRole } = renderSettings("/settings?tab=help");

    const docs = getByRole("link", { name: "Documentation" });
    const reference = getByRole("link", { name: "API Reference" });
    expect(docs.getAttribute("href")).toBe("/docs");
    expect(reference.getAttribute("href")).toBe("/reference");
  });

  it("presents Appearance, Theme and Desktop notifications in General", () => {
    const { getByRole } = renderSettings();

    expect(getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
    expect(getByRole("button", { name: "Default Theme" })).toBeTruthy();
    expect(getByRole("button", { name: "Graphite Theme" })).toBeTruthy();
    expect(getByRole("button", { name: "Sandstone Theme" })).toBeTruthy();
    expect(getByRole("switch", { name: "Desktop notifications" })).toBeTruthy();
  });

  it("offers a way back to the category list from a pushed pane", () => {
    const { getByRole } = renderSettings("/settings?tab=models");

    const back = getByRole("link", { name: "Settings" });
    expect(back.getAttribute("href")).toBe("/settings");
  });

  it("names the Connections action Add Project, not Onboard Project", () => {
    const { getByRole, queryByRole } = renderSettings("/settings?tab=trackers");

    expect(getByRole("button", { name: "Add Project" })).toBeTruthy();
    expect(queryByRole("button", { name: "Onboard Project" })).toBeNull();
  });
});
