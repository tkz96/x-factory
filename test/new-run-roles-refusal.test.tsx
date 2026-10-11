// test/new-run-roles-refusal.test.tsx — A run refused because its Builder or
// Reviewer role can't resolve links straight to Settings › Models (#278).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { NewRunModal } from "../src/frontend/components/modals/NewRunModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

afterEach(() => {
  cleanup();
  localStorage.removeItem("xf_selected_project");
});

afterAll(async () => {
  await unregisterHappyDom();
});

function NewRunHarness() {
  const { openNewRunModal } = useModal();
  return (
    <main id="app-root">
      <button type="button" id="trigger" onClick={() => openNewRunModal()}>
        Open
      </button>
      <NewRunModal />
    </main>
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

/** Opens the modal, fills the two required fields and submits. */
async function submitRun() {
  localStorage.setItem("xf_selected_project", "p1");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        ProjectProvider,
        null,
        createElement(
          ModalProvider,
          null,
          createElement(MemoryRouter, null, createElement(NewRunHarness)),
        ),
      ),
    ),
  );
  await act(async () => {
    fireEvent.click(el("trigger"));
  });
  typeInto(el("input-ticket-id"), "T-1");
  typeInto(el("input-ticket-title"), "A ticket");
  await act(async () => {
    fireEvent.click(el("btn-start"));
  });
  await flush();
  return view;
}

describe("a refused run start links to Settings › Models (#278)", () => {
  it("shows the refusal and a link that opens Settings › Models", async () => {
    api.createRun = mock(async () => {
      throw new Error(
        "Builder has no model. Choose a model in Settings › Models.",
      );
    }) as typeof api.createRun;
    await submitRun();

    // The modal is portalled to <body>.
    expect(document.body.textContent).toContain("Builder has no model");
    const link = document.getElementById(
      "link-settings-models",
    ) as HTMLAnchorElement | null;
    if (!link) throw new Error("Settings › Models link missing");
    expect(link.textContent).toBe("Open Settings › Models");
    expect(link.getAttribute("href")).toBe("/settings?tab=models");
  });

  it("shows no such link for any other failure", async () => {
    api.createRun = mock(async () => {
      throw new Error("Ticket T-1 already has an active run.");
    }) as typeof api.createRun;
    await submitRun();

    expect(document.body.textContent).toContain("already has an active run");
    expect(document.getElementById("link-settings-models")).toBeNull();
  });
});

describe("the New Run modal speaks plainly (#253)", () => {
  it("titles itself New Run, starts with Start Run and never says Factory or Pi", async () => {
    api.createRun = mock(async () => {
      throw new Error("nope");
    }) as typeof api.createRun;
    await submitRun();

    expect(document.getElementById("modal-new-run-title")?.textContent).toBe(
      "New Run",
    );
    expect(document.body.textContent).toContain("Start Run");
    expect(document.body.textContent).not.toContain("Factory Run");
    expect(document.body.textContent).not.toContain("Pi checks");
  });
});

describe("Settings opens the pane named in the URL", () => {
  const originalFetch = globalThis.fetch;

  function stubFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/diagnostics") ? {} : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  function renderSettings(path: string) {
    stubFetch();
    return render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
        },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(ModalProvider, null, createElement(SettingsView)),
        ),
      ),
    );
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("?tab=models opens the Models pane the refusal links to", () => {
    const { container } = renderSettings("/settings?tab=models");
    const pane = container.querySelector("#tab-models");
    expect(pane).not.toBeNull();
    expect(pane?.textContent).toContain("Model connections");
  });

  it("defaults to General without the query string", () => {
    const { container } = renderSettings("/settings");
    expect(container.querySelector("#tab-models")).toBeNull();
  });
});
