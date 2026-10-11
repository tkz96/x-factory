// test/new-run-conflict.test.tsx — A refused run creation opens the existing run
// (#255).
//
// The seam is the API client's fetch: the stub plays the server's replies, and
// the assertions are on what the app does — the modal closes, the app navigates
// to the existing run, and no error is shown.

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
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { NewRunModal } from "../src/frontend/components/modals/NewRunModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { ACTIVE_RUN_CONFLICT_CODE } from "../src/shared/run-creation.js";

const EXISTING_RUN_ID = "existing-run-42";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The page a navigation lands on, labelled with its path. */
function RunsRoute() {
  const { pathname } = useLocation();
  return createElement("div", { id: "run-page" }, pathname);
}

function Harness() {
  const { openNewRunModal } = useModal();
  return (
    <main id="app-root">
      <button type="button" id="trigger" onClick={() => openNewRunModal()}>
        Open
      </button>
      <NewRunModal />
      <Routes>
        <Route path="/runs/:id" element={createElement(RunsRoute)} />
      </Routes>
    </main>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <ModalProvider>
          <MemoryRouter initialEntries={["/tickets"]}>
            <Harness />
          </MemoryRouter>
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Opens the New Run modal and fills the two required fields. */
async function openAndFill() {
  const trigger = document.getElementById("trigger") as HTMLElement;
  act(() => trigger.focus());
  fireEvent.click(trigger);
  await flush();

  const ticketId = document.getElementById("input-ticket-id") as HTMLElement;
  const ticketTitle = document.getElementById(
    "input-ticket-title",
  ) as HTMLElement;
  const title = "Ticket one";
  act(() => {
    ticketId.focus();
    fireEvent.change(ticketId, { target: { value: "T-1" } });
    fireEvent.keyUp(ticketId);
    ticketTitle.focus();
    fireEvent.change(ticketTitle, { target: { value: title } });
    fireEvent.keyUp(ticketTitle);
  });
  await flush();
}

async function submit() {
  const form = document.getElementById("view-setup") as HTMLFormElement;
  await act(async () => {
    fireEvent.submit(form);
  });
  await flush();
}

describe("New Run conflict (#255)", () => {
  const originalFetch = globalThis.fetch;
  const originalProject = localStorage.getItem("xf_selected_project");
  let createdRuns = 0;

  beforeEach(() => {
    createdRuns = 0;
    // A project is already selected, so the form needs no projects fetch.
    localStorage.setItem("xf_selected_project", "proj-1");
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

  function stubCreateRun(reply: () => Response) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/projects")) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith("/api/runs") && init?.method === "POST") {
        createdRuns += 1;
        return Promise.resolve(reply());
      }
      return Promise.resolve(jsonResponse({ error: "unreachable" }, 500));
    }) as typeof fetch;
  }

  it("opens the existing run, without an error, when the server refuses a second active run", async () => {
    stubCreateRun(() =>
      jsonResponse(
        {
          error: `Ticket "T-1" already has an active run (${EXISTING_RUN_ID}).`,
          code: ACTIVE_RUN_CONFLICT_CODE,
          runId: EXISTING_RUN_ID,
        },
        409,
      ),
    );

    renderHarness();
    await flush();
    await openAndFill();
    expect(createdRuns).toBe(0);

    await submit();

    expect(createdRuns).toBe(1);
    // The modal closed and the app went to the run that is already active.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.getElementById("setup-error")).toBeNull();
    expect(document.getElementById("run-page")?.textContent).toBe(
      `/runs/${EXISTING_RUN_ID}`,
    );
  });

  it("still opens the run it created when the creation succeeds", async () => {
    stubCreateRun(() =>
      jsonResponse({ id: "fresh-run-7", ticket: { id: "T-1" } }, 201),
    );

    renderHarness();
    await flush();
    await openAndFill();
    await submit();

    expect(createdRuns).toBe(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.getElementById("run-page")?.textContent).toBe(
      "/runs/fresh-run-7",
    );
  });

  it("shows an error, and stays put, when the failure is not the active-run conflict", async () => {
    stubCreateRun(() => jsonResponse({ error: "Builder has no model." }, 409));

    renderHarness();
    await flush();
    await openAndFill();
    await submit();

    expect(createdRuns).toBe(1);
    expect(document.getElementById("run-page")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.getElementById("setup-error")?.textContent).toBe(
      "Builder has no model.",
    );
  });
});
