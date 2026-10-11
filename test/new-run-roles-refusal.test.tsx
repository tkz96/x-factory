// test/new-run-roles-refusal.test.tsx — A run refused because its Builder or
// Reviewer role can't resolve links straight to Settings › Models (#278).
//
// The seam is the API client's fetch, which is also what the other New Run
// tests stub: the stub plays the server's reply and the assertions are on what
// the user sees and where a click takes them.

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
import { NewRunModal } from "../src/frontend/components/modals/NewRunModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";

const ROLE_REFUSAL =
  "Builder has no model. Choose a model in Settings › Models.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

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

describe("a refused run start links to Settings › Models (#278)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // A project is already selected, so the form needs no projects fetch.
    localStorage.setItem("xf_selected_project", "proj-1");
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    localStorage.removeItem("xf_selected_project");
  });

  /** Plays the server: a project list, then one reply to POST /api/runs. */
  function stubCreateRun(status: number, body: unknown) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/projects")) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith("/api/runs") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(body, status));
      }
      return Promise.resolve(jsonResponse({ error: "unreachable" }, 500));
    }) as typeof fetch;
  }

  /** Opens the modal, fills the required fields and submits the form. */
  async function submitRun() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          ProjectProvider,
          null,
          createElement(
            ModalProvider,
            null,
            createElement(
              MemoryRouter,
              { initialEntries: ["/tickets"] },
              createElement(NewRunHarness),
            ),
          ),
        ),
      ),
    );
    await flush();

    const trigger = el("trigger");
    act(() => trigger.focus());
    fireEvent.click(trigger);
    await flush();

    const ticketId = el("input-ticket-id");
    const ticketTitle = el("input-ticket-title");
    act(() => {
      ticketId.focus();
      fireEvent.change(ticketId, { target: { value: "T-1" } });
      fireEvent.keyUp(ticketId);
      ticketTitle.focus();
      fireEvent.change(ticketTitle, { target: { value: "Ticket one" } });
      fireEvent.keyUp(ticketTitle);
    });
    await flush();

    const form = el<HTMLFormElement>("view-setup");
    await act(async () => {
      fireEvent.submit(form);
    });
    await flush();
  }

  it("shows the refusal and a link that opens Settings › Models", async () => {
    stubCreateRun(409, { error: ROLE_REFUSAL });
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
    stubCreateRun(409, { error: "Ticket T-1 already has an active run." });
    await submitRun();

    expect(document.body.textContent).toContain("already has an active run");
    expect(document.getElementById("link-settings-models")).toBeNull();
  });

  it("titles itself New Run, starts with Start Run and says neither Factory nor Pi", async () => {
    stubCreateRun(500, { error: "nope" });
    await submitRun();

    expect(el("modal-new-run-title").textContent).toBe("New Run");
    expect(document.body.textContent).toContain("Start Run");
    expect(document.body.textContent).not.toContain("Factory Run");
    expect(document.body.textContent).not.toContain("Pi checks");
  });
});

describe("Settings opens the pane named in the URL", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  function renderSettings(path: string) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/diagnostics") ? {} : [];
      return jsonResponse(body);
    }) as typeof fetch;
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

afterAll(async () => {
  await unregisterHappyDom();
});
