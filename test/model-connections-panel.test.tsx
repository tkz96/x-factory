// test/model-connections-panel.test.tsx — Settings › Models: add a connection,
// check it, pick models from the check, and edit their details (#277). The
// api-client is the only mocked seam.

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
  mock,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { MODEL_CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ModelConnectionsPanel } from "../src/frontend/components/settings/ModelConnectionsPanel.js";
import { api } from "../src/frontend/lib/api-client.js";
import type {
  ModelConnectionView,
  ModelRecord,
} from "../src/shared/model-connection-types.js";

function connection(
  overrides: Partial<ModelConnectionView> = {},
): ModelConnectionView {
  return {
    id: "c1",
    name: "My Gemini key",
    apiType: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    verifiedAt: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    models: [],
    availableModels: [],
    hasKey: true,
    keyLast4: "wxyz",
    keySource: "stored",
    ...overrides,
  };
}

let connections: ModelConnectionView[];

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ModelConnectionsPanel />
    </QueryClientProvider>,
  );
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

/** Types like a user; the keyup is what React's fallback value watcher needs. */
function typeInto(target: HTMLElement, value: string) {
  act(() => {
    target.focus();
    fireEvent.change(target, { target: { value } });
    fireEvent.keyUp(target);
  });
}

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function click(target: HTMLElement) {
  await act(async () => {
    fireEvent.click(target);
  });
  await flush();
}

describe("ModelConnectionsPanel (#277)", () => {
  beforeEach(() => {
    connections = [connection()];
    api.listModelConnections = mock(async () => connections);
  });

  afterEach(() => cleanup());

  it("lists connections with the key masked to its last 4 characters and the check state", async () => {
    renderPanel();
    await flush();
    const text = document.body.textContent ?? "";
    expect(text).toContain("My Gemini key");
    expect(text).toContain("•••• wxyz");
    expect(text).toContain("Not checked");
  });

  it("shows Verified only for a connection whose check passed", async () => {
    connections = [connection({ verifiedAt: "2026-10-11T01:00:00.000Z" })];
    renderPanel();
    await flush();
    expect(document.body.textContent).toContain("Verified");
  });

  it("adds a connection with a hidden key field and the Gemini URL pre-filled", async () => {
    const create = mock(async () => connection({ id: "c2", name: "New" }));
    api.createModelConnection = create as typeof api.createModelConnection;
    renderPanel();
    await flush();

    await click(el("btn-add-model-connection"));
    expect(el<HTMLInputElement>("model-connection-key").type).toBe("password");
    act(() => {
      fireEvent.change(el("model-connection-type"), {
        target: { value: "gemini" },
      });
    });
    await flush();
    expect(el<HTMLInputElement>("model-connection-url").value).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    typeInto(el("model-connection-name"), "Work Gemini");
    typeInto(el("model-connection-key"), "AQ.secret-key");
    await click(el("btn-save-model-connection"));

    expect(create).toHaveBeenCalledWith({
      name: "Work Gemini",
      apiType: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AQ.secret-key",
    });
  });

  it("Check Connection lists the models found, and each can be added", async () => {
    api.checkModelConnection = mock(async () => ({
      ok: true as const,
      models: [{ id: "gemini-flash-lite-latest", name: "Flash-Lite" }],
    }));
    const add = mock(
      async (): Promise<ModelRecord> => ({
        modelId: "gemini-flash-lite-latest",
        limits: {},
        budget: { perDay: {} },
      }),
    );
    api.addConnectionModel = add as typeof api.addConnectionModel;
    renderPanel();
    await flush();

    await click(el("btn-check-model-connection-c1"));
    expect(document.body.textContent).toContain("Flash-Lite");
    await click(el("btn-add-model-c1-gemini-flash-lite-latest"));
    expect(add).toHaveBeenCalledWith("c1", "gemini-flash-lite-latest");
  });

  it("shows a failed check's plain error", async () => {
    api.checkModelConnection = mock(async () => ({
      ok: false as const,
      error: {
        category: "key rejected" as const,
        status: 401,
        message: "Key rejected (401)",
      },
    }));
    renderPanel();
    await flush();
    await click(el("btn-check-model-connection-c1"));
    expect(document.body.textContent).toContain("Key rejected (401)");
  });

  it("edits a chosen model's details, limits and budget", async () => {
    connections = [
      connection({
        models: [
          {
            modelId: "m1",
            contextWindow: 1000,
            limits: {},
            budget: { perDay: {} },
          },
        ],
      }),
    ];
    const update = mock(
      async (): Promise<ModelRecord> => ({
        modelId: "m1",
        limits: {},
        budget: { perDay: {} },
      }),
    );
    api.updateConnectionModel = update as typeof api.updateConnectionModel;
    renderPanel();
    await flush();

    expect(el<HTMLInputElement>("model-c1-m1-contextWindow").value).toBe(
      "1000",
    );
    typeInto(el("model-c1-m1-contextWindow"), "200000");
    typeInto(el("model-c1-m1-inputPricePerMTok"), "0.25");
    typeInto(el("model-c1-m1-rpm"), "5");
    typeInto(el("model-c1-m1-budgetUsd"), "5");
    typeInto(el("model-c1-m1-maxOutputTokens"), "");
    await click(el("btn-save-model-c1-m1"));

    expect(update).toHaveBeenCalledWith("c1", "m1", {
      contextWindow: 200000,
      maxOutputTokens: null,
      inputPricePerMTok: 0.25,
      outputPricePerMTok: null,
      limits: { rpm: 5 },
      budget: { perDay: { usd: 5 } },
    });
  });

  it("asks for confirmation before deleting a connection", async () => {
    const remove = mock(async () => ({ ok: true }));
    api.deleteModelConnection = remove as typeof api.deleteModelConnection;
    renderPanel();
    await flush();

    await click(el("btn-delete-model-connection-c1"));
    expect(remove).not.toHaveBeenCalled();
    // The alert dialog's own confirm action carries the words, not an id.
    const alert = document.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement | null;
    if (!alert) throw new Error("alertdialog missing");
    await click(
      within(alert).getByRole("button", {
        name: MODEL_CONNECTIONS_COPY.confirmDelete,
      }),
    );
    expect(remove).toHaveBeenCalledWith("c1");
  });

  it("confirms in an alertdialog: Escape cancels and focus returns to Delete", async () => {
    const remove = mock(async () => ({ ok: true }));
    api.deleteModelConnection = remove as typeof api.deleteModelConnection;
    renderPanel();
    await flush();

    const trigger = el("btn-delete-model-connection-c1");
    act(() => trigger.focus());
    await click(trigger);

    const dialog = document.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement | null;
    if (!dialog) throw new Error("alertdialog missing");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("Delete Connection");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toContain("My Gemini key");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(remove).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("marks the key field as a new password field", async () => {
    renderPanel();
    await flush();
    await click(el("btn-add-model-connection"));
    expect(
      el<HTMLInputElement>("model-connection-key").getAttribute("autocomplete"),
    ).toBe("new-password");
  });

  it("edits a connection with the same payload builder and keeps a blank key", async () => {
    const update = mock(async () => connection());
    api.updateModelConnection = update as typeof api.updateModelConnection;
    renderPanel();
    await flush();

    const editButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Edit",
    );
    if (!(editButton instanceof HTMLElement)) throw new Error("Edit missing");
    await click(editButton);
    typeInto(el("model-connection-name"), "  Renamed  ");
    await click(el("btn-save-model-connection"));

    expect(update).toHaveBeenCalledWith("c1", {
      name: "Renamed",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    });
  });
});

afterAll(async () => {
  await unregisterHappyDom();
});
