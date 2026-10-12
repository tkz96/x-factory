// test/new-run-modal-fields.test.tsx — The New Run form says what it needs.
//
// The server refuses a run without an implementation plan, so the form marks
// the plan required and keeps Start Run disabled until it is filled, as it does
// for the ticket ID and title. Each field's help is a focusable, named button;
// role="tooltip" belongs to the popup it opens, never to the button.

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
import { MemoryRouter } from "react-router-dom";
import { NewRunModal } from "../src/frontend/components/modals/NewRunModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";

function Harness() {
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

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function typeInto(id: string, value: string) {
  const target = el(id);
  act(() => {
    target.focus();
    fireEvent.change(target, { target: { value } });
    fireEvent.keyUp(target);
  });
}

async function openModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <MemoryRouter initialEntries={["/tickets"]}>
            <Harness />
          </MemoryRouter>
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  await flush();
  const trigger = el("trigger");
  act(() => trigger.focus());
  fireEvent.click(trigger);
  await flush();
}

const startRun = () => el<HTMLButtonElement>("btn-start");

describe("New Run form fields", () => {
  const originalFetch = globalThis.fetch;
  const originalProject = localStorage.getItem("xf_selected_project");
  let posts = 0;

  beforeEach(() => {
    posts = 0;
    localStorage.setItem("xf_selected_project", "proj-1");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/runs") && init?.method === "POST") {
        posts += 1;
      }
      return Promise.resolve(
        new Response("[]", { headers: { "Content-Type": "application/json" } }),
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    if (originalProject === null)
      localStorage.removeItem("xf_selected_project");
    else localStorage.setItem("xf_selected_project", originalProject);
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("marks the implementation plan required, like the ticket ID and title", async () => {
    await openModal();
    expect(el<HTMLInputElement>("input-ticket-id").required).toBe(true);
    expect(el<HTMLInputElement>("input-ticket-title").required).toBe(true);
    expect(el<HTMLTextAreaElement>("input-plan").required).toBe(true);
  });

  it("keeps Start Run disabled until the plan is filled", async () => {
    await openModal();
    typeInto("input-ticket-id", "T-1");
    typeInto("input-ticket-title", "Ticket one");
    await flush();
    expect(startRun().disabled).toBe(true);

    typeInto("input-plan", "   ");
    await flush();
    expect(startRun().disabled).toBe(true);

    typeInto("input-plan", "1. Do it.");
    await flush();
    expect(startRun().disabled).toBe(false);
  });

  it("does not send a run without a plan, and says why", async () => {
    await openModal();
    typeInto("input-ticket-id", "T-1");
    typeInto("input-ticket-title", "Ticket one");
    await act(async () => {
      fireEvent.submit(el<HTMLFormElement>("view-setup"));
    });
    await flush();
    expect(posts).toBe(0);
    expect(el("setup-error").textContent).toContain("Implementation Plan");
  });

  it("gives each field a named help button, and only the popup is a tooltip", async () => {
    await openModal();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    for (const field of [
      "Ticket ID",
      "Ticket Title",
      "Custom Branch",
      "Acceptance Criteria",
      "Implementation Plan",
    ]) {
      const help = within(document.body).getByRole("button", {
        name: `Help: ${field}`,
      });
      expect(help.tagName).toBe("BUTTON");
      expect(help.getAttribute("role")).toBeNull();
    }
  });

  it("focusing a help button opens its tooltip and describes the button with it", async () => {
    await openModal();
    const help = within(document.body).getByRole("button", {
      name: "Help: Ticket ID",
    });
    act(() => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      help.focus();
    });
    await flush();
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain("Ticket Identifier");
    expect(help.getAttribute("aria-describedby")).toBe(tooltip?.id ?? "none");
  });
});
