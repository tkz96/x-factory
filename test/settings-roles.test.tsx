// test/settings-roles.test.tsx — Settings › Models: choose the Builder and
// Reviewer models from verified connections (#278). Replaces the free-text
// Session A / Session B form. The seam is the API client's fetch: the stub
// plays the server's replies, and the assertions are on what the pickers show
// and what they POST.

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
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";
import type { ModelConnectionView } from "../src/shared/model-connection-types.js";

function connection(
  overrides: Partial<ModelConnectionView>,
): ModelConnectionView {
  return {
    id: "c1",
    name: "Gemini",
    apiType: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    verifiedAt: "2026-10-11T00:00:00.000Z",
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    models: [],
    availableModels: [],
    hasKey: true,
    keyLast4: "abcd",
    keySource: "stored",
    ...overrides,
  };
}

const record = (modelId: string) => ({
  modelId,
  limits: {},
  budget: { perDay: {} },
});

const CONNECTIONS: ModelConnectionView[] = [
  connection({
    id: "c1",
    name: "Gemini",
    models: [record("gemini-flash-lite-latest"), record("gemini-pro")],
  }),
  // Not checked: its models must not be offered.
  connection({
    id: "c2",
    name: "Unchecked router",
    apiType: "openai-compatible",
    verifiedAt: null,
    models: [record("vendor/hidden-model")],
  }),
];

let serverSettings: Record<string, unknown>;
let postedBodies: unknown[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openModelsTab(container: HTMLElement) {
  await act(async () => {
    fireEvent.click(container.querySelector('[data-tab="models"]') as Element);
  });
  await flush();
}

function picker(role: "builder" | "reviewer"): HTMLSelectElement {
  const el = document.getElementById(`setting-role-${role}`);
  if (!el) throw new Error(`missing role picker ${role}`);
  return el as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

async function choose(select: HTMLSelectElement, label: string) {
  const option = Array.from(select.options).find(
    (o) => o.textContent === label,
  );
  if (!option) throw new Error(`no option "${label}"`);
  await act(async () => {
    fireEvent.change(select, { target: { value: option.value } });
  });
  await flush();
}

describe("Settings › Models roles (#278)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    postedBodies = [];
    serverSettings = {
      theme: "dark",
      roles: {
        builder: { connectionId: "c1", modelId: "gemini-flash-lite-latest" },
      },
    };
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/model-connections")) {
        return Promise.resolve(jsonResponse(CONNECTIONS));
      }
      if (url.includes("/api/settings")) {
        if (init?.method === "POST") {
          postedBodies.push(JSON.parse(String(init.body)) as unknown);
        }
        return Promise.resolve(jsonResponse(serverSettings));
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

  it("offers only models on verified connections, and shows each role's current model", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    expect(optionLabels(picker("builder"))).toEqual([
      "Not set",
      "gemini-flash-lite-latest — Gemini",
      "gemini-pro — Gemini",
    ]);
    expect(picker("builder").selectedOptions[0]?.textContent).toBe(
      "gemini-flash-lite-latest — Gemini",
    );
    expect(picker("reviewer").selectedOptions[0]?.textContent).toBe("Not set");
  });

  it("saves a role as soon as it is chosen, as {connectionId, modelId}", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    await choose(picker("reviewer"), "gemini-pro — Gemini");
    expect(postedBodies).toEqual([
      { roles: { reviewer: { connectionId: "c1", modelId: "gemini-pro" } } },
    ]);
  });

  it("clears a role with Not set", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    await choose(picker("builder"), "Not set");
    expect(postedBodies).toEqual([{ roles: { builder: null } }]);
  });

  it("notes when both roles use the same model", async () => {
    serverSettings = {
      theme: "dark",
      roles: {
        builder: { connectionId: "c1", modelId: "gemini-pro" },
        reviewer: { connectionId: "c1", modelId: "gemini-pro" },
      },
    };
    const { container } = renderSettings();
    await openModelsTab(container);
    expect(container.textContent).toContain(
      "Builder and Reviewer use the same model",
    );
  });

  it("no longer shows the free-text Session A / Session B fields", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);
    expect(container.querySelector("#setting-model-a-provider")).toBeNull();
    expect(container.querySelector("#setting-model-b-model")).toBeNull();
  });
});
