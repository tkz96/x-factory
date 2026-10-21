// test/new-run-modal-fields.test.tsx — The New Run form says what it needs.
//
// The implementation plan is optional: the Builder writes one when the operator
// gives none, so the form never requires it and never pre-fills a canned plan.
// Each field's help is a focusable, named button; role="tooltip" belongs to the
// popup it opens, never to the button.

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
      <button
        type="button"
        id="trigger-ticket"
        onClick={() =>
          openNewRunModal({
            projectId: "proj-1",
            ticketId: "T-9",
            ticketTitle: "Ticket nine",
            criteria: ["It works"],
          })
        }
      >
        Open from a ticket
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

async function openModal(from = "trigger") {
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
  const trigger = el(from);
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

  it("marks only the ticket ID and title required; the plan is optional", async () => {
    await openModal();
    expect(el<HTMLInputElement>("input-ticket-id").required).toBe(true);
    expect(el<HTMLInputElement>("input-ticket-title").required).toBe(true);
    expect(el<HTMLTextAreaElement>("input-plan").required).toBe(false);
  });

  it("enables Start Run once the ticket ID and title are filled, with no plan", async () => {
    await openModal();
    typeInto("input-ticket-id", "T-1");
    typeInto("input-ticket-title", "Ticket one");
    await flush();
    expect(startRun().disabled).toBe(false);
  });

  it("does not pre-fill a canned plan when a ticket opens the form", async () => {
    await openModal("trigger-ticket");
    expect(el<HTMLInputElement>("input-ticket-title").value).toBe(
      "Ticket nine",
    );
    expect(el<HTMLTextAreaElement>("input-plan").value).toBe("");
  });

  it("sends a run without a plan", async () => {
    await openModal();
    typeInto("input-ticket-id", "T-1");
    typeInto("input-ticket-title", "Ticket one");
    await act(async () => {
      fireEvent.submit(el<HTMLFormElement>("view-setup"));
    });
    await flush();
    expect(posts).toBe(1);
    expect(document.getElementById("setup-error")).toBeNull();
  });

  it("gives each field a named help button, and only the popup is a tooltip", async () => {
    await openModal();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    for (const field of [
      "Ticket ID",
      "Ticket Title",
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

  it("labels the branch field optional, and explains it in help text beside the input", async () => {
    await openModal();
    // SYS-13: "Branch (optional)", with the explanation as the field's own
    // description rather than a tooltip — the label says all it needs to.
    expect(
      within(document.body).getByLabelText("Branch (optional)"),
    ).toBeTruthy();
    expect(
      within(document.body).queryByRole("button", { name: "Help: Branch" }),
    ).toBeNull();
    expect(
      document.querySelector(".ui-field-description")?.textContent,
    ).toContain("Leave it blank");
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
