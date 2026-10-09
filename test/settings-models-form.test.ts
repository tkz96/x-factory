// test/settings-models-form.test.ts — The Pi & Models form writes the
// {provider, model} wire contract end to end (#182).
//
// The seam is the API client's fetch: the stub plays the server's documented
// replies with literal bodies, and the assertions are on what the form reads
// into its fields and actually POSTs. A string scalar here is exactly the
// defect that corrupted settings.json.

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
import { SettingsView } from "../src/frontend/views/SettingsView.js";

const SERVER_SETTINGS = {
  theme: "dark",
  models: {
    sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
    sessionB: { provider: "ollama", model: "qwen2.5-coder:32b" },
  },
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        null,
        createElement(ModalProvider, null, createElement(SettingsView)),
      ),
    ),
  );
}

describe("Pi & Models settings form (#182)", () => {
  const originalFetch = globalThis.fetch;
  let postedBodies: unknown[] = [];

  beforeEach(() => {
    postedBodies = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/settings")) {
        if (init?.method === "POST") {
          postedBodies.push(JSON.parse(String(init.body)) as unknown);
          return Promise.resolve(jsonResponse(SERVER_SETTINGS));
        }
        return Promise.resolve(jsonResponse(SERVER_SETTINGS));
      }
      // Every other query (projects, diagnostics) fails like an unreachable API.
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

  async function openModelsTab(container: HTMLElement) {
    fireEvent.click(container.querySelector('[data-tab="models"]') as Element);
    await waitFor(() => {
      expect(
        (
          container.querySelector(
            "#setting-model-a-provider",
          ) as HTMLInputElement
        ).value,
      ).toBe("anthropic");
    });
  }

  /** The connect-step typing pattern: focus + change + keyUp inside act. */
  function typeInput(input: HTMLElement, value: string) {
    act(() => {
      input.focus();
      fireEvent.change(input, { target: { value } });
      fireEvent.keyUp(input);
    });
  }

  it("shows each saved {provider, model} pair in the form fields", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    expect(
      (container.querySelector("#setting-model-a-model") as HTMLInputElement)
        .value,
    ).toBe("claude-3-7-sonnet");
    expect(
      (container.querySelector("#setting-model-b-provider") as HTMLInputElement)
        .value,
    ).toBe("ollama");
    expect(
      (container.querySelector("#setting-model-b-model") as HTMLInputElement)
        .value,
    ).toBe("qwen2.5-coder:32b");
  });

  it("posts {provider, model} objects — never a string scalar", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    typeInput(
      container.querySelector("#setting-model-a-model") as HTMLElement,
      "gpt-4o",
    );
    fireEvent.click(container.querySelector("#btn-save-settings") as Element);

    await waitFor(() => expect(postedBodies.length).toBe(1));
    expect(postedBodies[0]).toEqual({
      models: {
        sessionA: { provider: "anthropic", model: "gpt-4o" },
        sessionB: { provider: "ollama", model: "qwen2.5-coder:32b" },
      },
    });

    await waitFor(() => {
      expect(container.querySelector("#settings-status")?.textContent).toBe(
        "Settings saved successfully.",
      );
    });
  });
});
