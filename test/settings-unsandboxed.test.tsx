// test/settings-unsandboxed.test.tsx — SettingsView unsandboxed opt-in confirmation and persistence (#275).

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
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function renderSettings(queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
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

describe("SettingsView unsandboxed execution opt-in (#275)", () => {
  const originalFetch = globalThis.fetch;
  let postedBodies: unknown[] = [];
  let currentSettings: Record<string, unknown> = {
    theme: "dark",
    allowUnsandboxed: false,
  };

  beforeEach(() => {
    postedBodies = [];
    currentSettings = {
      theme: "dark",
      allowUnsandboxed: false,
    };
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
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("renders the unsandboxed checkbox unchecked by default", async () => {
    const { container } = renderSettings();
    await waitFor(() => {
      const checkbox = container.querySelector(
        "#setting-allow-unsandboxed",
      ) as HTMLInputElement;
      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(false);
    });
  });

  it("shows confirmation modal when clicking to enable unsandboxed execution", async () => {
    const { container } = renderSettings();
    await waitFor(() => {
      expect(
        container.querySelector("#setting-allow-unsandboxed"),
      ).not.toBeNull();
    });

    const checkbox = container.querySelector(
      "#setting-allow-unsandboxed",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    // Modal should be open
    await waitFor(() => {
      const modal = document.getElementById("modal-confirm-unsandboxed");
      expect(modal).not.toBeNull();
      expect(modal?.textContent).toContain("without a sandbox");
    });

    // No POST should have happened yet
    expect(postedBodies.length).toBe(0);
  });

  it("dismisses confirmation modal on Cancel without saving", async () => {
    const { container } = renderSettings();
    await waitFor(() => {
      expect(
        container.querySelector("#setting-allow-unsandboxed"),
      ).not.toBeNull();
    });

    const checkbox = container.querySelector(
      "#setting-allow-unsandboxed",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(
        document.getElementById("modal-confirm-unsandboxed"),
      ).not.toBeNull();
    });

    const cancelBtn = document.getElementById("btn-cancel-unsandboxed");
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }

    await waitFor(() => {
      expect(document.getElementById("modal-confirm-unsandboxed")).toBeNull();
    });

    expect(postedBodies.length).toBe(0);
    expect(checkbox.checked).toBe(false);
  });

  it("posts allowUnsandboxed: true when confirmed in modal", async () => {
    const { container } = renderSettings();
    await waitFor(() => {
      expect(
        container.querySelector("#setting-allow-unsandboxed"),
      ).not.toBeNull();
    });

    const checkbox = container.querySelector(
      "#setting-allow-unsandboxed",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(
        document.getElementById("modal-confirm-unsandboxed"),
      ).not.toBeNull();
    });

    const confirmBtn = document.getElementById("btn-confirm-unsandboxed");
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    await waitFor(() => {
      expect(postedBodies.length).toBe(1);
    });

    expect(postedBodies[0]).toEqual({ allowUnsandboxed: true });
    await waitFor(() => {
      expect(document.getElementById("modal-confirm-unsandboxed")).toBeNull();
    });
  });

  it("unchecking when already enabled posts allowUnsandboxed: false without a modal", async () => {
    currentSettings = { theme: "dark", allowUnsandboxed: true };

    const { container } = renderSettings();
    await waitFor(() => {
      const checkbox = container.querySelector(
        "#setting-allow-unsandboxed",
      ) as HTMLInputElement;
      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(true);
    });

    const checkbox = container.querySelector(
      "#setting-allow-unsandboxed",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    // Modal should NOT open
    expect(document.getElementById("modal-confirm-unsandboxed")).toBeNull();

    await waitFor(() => {
      expect(postedBodies.length).toBe(1);
    });

    expect(postedBodies[0]).toEqual({ allowUnsandboxed: false });
  });
});
