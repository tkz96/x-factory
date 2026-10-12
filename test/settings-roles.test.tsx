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
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
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
    fireEvent.click(within(container).getByRole("link", { name: "Models" }));
  });
  await flush();
}

/** The role's select trigger: the shared select block, named by the row (S-07). */
function picker(role: "builder" | "reviewer"): HTMLElement {
  return within(document.body).getByRole("button", {
    name: new RegExp(role, "i"),
  });
}

/** Opens the picker's listbox and reads the labels it offers. */
async function optionLabels(role: "builder" | "reviewer"): Promise<string[]> {
  await act(async () => {
    fireEvent.click(picker(role));
  });
  const labels = within(document.body)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
  // Close the listbox from itself: while it is open React Aria hides the rest
  // of the page from assistive technology, the trigger included.
  await act(async () => {
    fireEvent.keyDown(within(document.body).getByRole("listbox"), {
      key: "Escape",
    });
  });
  return labels;
}

async function choose(role: "builder" | "reviewer", label: string) {
  await act(async () => {
    fireEvent.click(picker(role));
  });
  const option = within(document.body).getByRole("option", { name: label });
  await act(async () => {
    fireEvent.click(option);
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

    expect(await optionLabels("builder")).toEqual([
      "Not set",
      "gemini-flash-lite-latest — Gemini",
      "gemini-pro — Gemini",
    ]);
    expect(picker("builder").textContent).toContain(
      "gemini-flash-lite-latest — Gemini",
    );
    expect(picker("reviewer").textContent).toContain("Not set");
  });

  it("labels each model by its display name, and by its id when it has none", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/model-connections")) {
        return Promise.resolve(
          jsonResponse([
            connection({
              id: "c3",
              name: "FreeLLMAPI",
              apiType: "openai-compatible",
              models: [
                { ...record("mistral-large-3"), name: "Mistral Large 3" },
                record("plain-model"),
              ],
            }),
          ]),
        );
      }
      return Promise.resolve(jsonResponse(serverSettings));
    }) as typeof fetch;
    const { container } = renderSettings();
    await openModelsTab(container);

    expect(await optionLabels("reviewer")).toEqual([
      "Not set",
      "Mistral Large 3 — FreeLLMAPI",
      "plain-model — FreeLLMAPI",
    ]);
  });

  it("saves a role as soon as it is chosen, as {connectionId, modelId}", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    await choose("reviewer", "gemini-pro — Gemini");
    expect(postedBodies).toEqual([
      { roles: { reviewer: { connectionId: "c1", modelId: "gemini-pro" } } },
    ]);
  });

  it("clears a role with Not set", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    await choose("builder", "Not set");
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

  it("offers each role as a row of the shared select block, never a native select", async () => {
    const { container } = renderSettings();
    await openModelsTab(container);

    // The free-text Session A / Session B fields are gone, and so is the
    // native <select> (S-07): each role is a row whose words lead and whose
    // select trails.
    expect(container.querySelector("#setting-model-a-provider")).toBeNull();
    expect(container.querySelector("#setting-model-b-model")).toBeNull();
    const control = picker("builder");
    const builderRow = control.closest("li");
    expect(control.getAttribute("aria-haspopup")).toBe("listbox");
    expect(builderRow?.textContent).toContain("Builder");
    // The only <select> in the row is the block's hidden form-integration node:
    // what the user sees and reaches is the listbox.
  });
});
