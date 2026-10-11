// test/settings-theme-choice.test.tsx — The Theme setting (Default, Graphite, Sandstone) in Settings › General (#249).
// Appearance (#248) and Theme are separate: choosing a theme never changes Light/Dark.

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

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        null,
        createElement(ModalProvider, null, createElement(SettingsView)),
      ),
    ),
  );
}

afterAll(async () => {
  await unregisterHappyDom();
});

describe("Settings › General: Theme choice (#249)", () => {
  const originalFetch = globalThis.fetch;
  let postedBodies: unknown[] = [];
  let currentSettings: Record<string, unknown> = {};

  beforeEach(() => {
    postedBodies = [];
    currentSettings = { theme: "default", appearance: "automatic" };
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/settings")) {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          postedBodies.push(body);
          currentSettings = { ...currentSettings, ...body };
          return Promise.resolve(jsonResponse(currentSettings));
        }
        return Promise.resolve(jsonResponse(currentSettings));
      }
      return Promise.resolve(jsonResponse({ error: "unreachable" }, 500));
    }) as typeof fetch;
    act(() => setTheme("default"));
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    // The theme store is shared with every later test file: leave it at Default.
    act(() => setTheme("default"));
  });

  it("offers Default, Graphite and Sandstone as a Theme choice, apart from Appearance", () => {
    const { getByRole, getByText } = renderSettings();

    expect(getByText("Theme")).toBeTruthy();
    expect(getByRole("button", { name: "Default Theme" })).toBeTruthy();
    expect(getByRole("button", { name: "Graphite Theme" })).toBeTruthy();
    expect(getByRole("button", { name: "Sandstone Theme" })).toBeTruthy();
    // The Appearance choice moved to the segmented-control block in #251: one
    // control, mutually exclusive options, so the segments are radios in a
    // named radiogroup rather than aria-pressed buttons.
    expect(getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
    expect(getByRole("radio", { name: "Automatic Appearance" })).toBeTruthy();
  });

  it("marks the chosen theme as pressed", () => {
    // The app shell hydrates the shared theme from the saved settings (#249).
    act(() => setTheme("sandstone"));
    const { getByRole } = renderSettings();

    expect(
      getByRole("button", { name: "Sandstone Theme" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      getByRole("button", { name: "Default Theme" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });

  it("choosing Graphite saves the theme, applies it to the document and leaves Appearance alone", async () => {
    const { getByRole } = renderSettings();

    fireEvent.click(getByRole("button", { name: "Graphite Theme" }));

    await waitFor(() => {
      expect(postedBodies).toContainEqual({ theme: "graphite" });
    });
    expect(postedBodies.some((b) => "appearance" in (b as object))).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "graphite",
    );
    expect(localStorage.getItem("xf_theme_choice")).toBe("graphite");
  });
});
