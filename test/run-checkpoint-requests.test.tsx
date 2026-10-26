// test/run-checkpoint-requests.test.tsx — What the run page sends to the server when a checkpoint button
// is pressed, and what the reader sees when the server refuses it: the request each button makes, the
// pending label while it is in flight, the "already moved on" notice, the error line, and Start New Run.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunDetailView } from "../src/frontend/views/RunDetailView.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    RealEventSource;
});
afterAll(async () => {
  await unregisterHappyDom();
});

const realFetch = globalThis.fetch;
const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const AT = "2026-09-20T12:34:56.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "1. Read the parser.",
    branch: "feat/login",
    status,
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
    ...overrides,
  } as Run;
}

interface Request {
  method: string;
  path: string;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Renders the run page for run-1 on the app's data router. Every request goes to `respond`, which
 * receives the request and returns the response; the requests made are recorded in order.
 */
function renderRunPage(
  status: RunStatus,
  respond: (req: Request) => Response | Promise<Response>,
) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const req: Request = {
      method: init?.method ?? "GET",
      path: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(req);
    if (req.method === "GET") return json(makeRun(status));
    return respond(req);
  }) as unknown as typeof fetch;
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.run("run-1"), makeRun(status));
  client.setQueryData(queryKeys.runEvents("run-1"), []);
  const router = createMemoryRouter(
    [{ path: "/runs/:runId", element: <RunDetailView /> }],
    { initialEntries: ["/runs/run-1"] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <ModalProvider>
        <RouterProvider router={router} />
      </ModalProvider>
    </QueryClientProvider>,
  );
  return { ...view, requests, router };
}

/** The run's writes, in the order sent; the page's own refetches are reads and are left out. */
function writesOf(requests: Request[]): Request[] {
  return requests.filter((r) => r.method !== "GET");
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  return within(container).getByRole("button", {
    name,
  }) as HTMLButtonElement;
}

/** The OK answer every run mutation gives, carrying the run in its new status. */
const okWith = (status: RunStatus) => json({ ok: true, run: makeRun(status) });

describe("each checkpoint button makes the request the server expects", () => {
  it("Approve Plan posts the approve transition", async () => {
    const { container, requests } = renderRunPage(
      "awaiting_plan_approval",
      () => okWith("executing"),
    );
    await waitFor(() => button(container, "Approve Plan"));
    fireEvent.click(button(container, "Approve Plan"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]).toEqual({
      method: "POST",
      path: "/api/runs/run-1/transitions",
      body: { action: "approve" },
    });
  });

  it("Request Changes on a plan posts the restart transition", async () => {
    const { container, requests } = renderRunPage(
      "awaiting_plan_approval",
      () => okWith("planning"),
    );
    fireEvent.click(await waitForButton(container, "Request Changes"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]?.body).toEqual({ action: "restart" });
  });

  it("Confirm Rework posts the requeue transition with the reader's notes", async () => {
    const { container, requests } = renderRunPage("awaiting_review", () =>
      okWith("planning"),
    );
    fireEvent.click(await waitForButton(container, "Request Changes"));
    const area = container.querySelector(
      "form.run-chat-input textarea",
    ) as HTMLTextAreaElement;
    act(() => {
      area.focus();
      fireEvent.change(area, { target: { value: "Split the parser" } });
      fireEvent.keyUp(area);
    });
    act(() => {
      fireEvent.submit(area.closest("form") as HTMLFormElement);
    });
    fireEvent.click(await waitForButton(container, "Confirm Rework"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]).toEqual({
      method: "POST",
      path: "/api/runs/run-1/transitions",
      body: { action: "requeue", payload: { chatNotes: "Split the parser" } },
    });
  });

  it("Create Pull Request posts to the pr endpoint", async () => {
    const { container, requests } = renderRunPage("ready_for_pr", () =>
      json({ ok: true, queued: true }),
    );
    fireEvent.click(await waitForButton(container, "Create Pull Request"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]).toEqual({
      method: "POST",
      path: "/api/runs/run-1/pr",
      body: undefined,
    });
  });

  it("Resume Run posts to the resume endpoint", async () => {
    const { container, requests } = renderRunPage("recovery_required", () =>
      okWith("executing"),
    );
    fireEvent.click(await waitForButton(container, "Resume Run"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]?.path).toBe("/api/runs/run-1/resume");
    expect(writesOf(requests)[0]?.method).toBe("POST");
  });

  it("Retry Review posts to the retry-review endpoint", async () => {
    const { container, requests } = renderRunPage("review_retry_required", () =>
      okWith("executing"),
    );
    fireEvent.click(await waitForButton(container, "Retry Review"));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]?.path).toBe("/api/runs/run-1/retry-review");
  });

  it("Abandon Run, once confirmed, posts the abandon with the reason the page gives", async () => {
    const { container, requests } = renderRunPage("recovery_required", () =>
      okWith("failed"),
    );
    fireEvent.click(await waitForButton(container, "Abandon Run"));
    const alert = within(document.body).getByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Abandon Run" }));
    await waitFor(() => expect(writesOf(requests)).toHaveLength(1));
    expect(writesOf(requests)[0]).toEqual({
      method: "POST",
      path: "/api/runs/run-1/abandon",
      body: { reason: "chosen on the run page" },
    });
  });
});

describe("a checkpoint action in flight labels its button and holds its siblings", () => {
  it("shows Approving… on the pressed button until the server answers", async () => {
    let answer: (res: Response) => void = () => {};
    const { container } = renderRunPage(
      "awaiting_plan_approval",
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    fireEvent.click(await waitForButton(container, "Approve Plan"));
    await waitFor(() => button(container, "Approving…"));
    expect(button(container, "Approving…").disabled).toBe(true);
    expect(button(container, "Request Changes").disabled).toBe(true);

    await act(async () => {
      answer(okWith("executing"));
    });
    await waitFor(() => expect(container.textContent).toContain("Approved"));
  });
});

describe("a refused checkpoint action says what happened", () => {
  it("says the run already moved on, and fetches its latest state", async () => {
    const { container, requests } = renderRunPage(
      "awaiting_plan_approval",
      () => json({ error: "Run has moved on" }, 409),
    );
    fireEvent.click(await waitForButton(container, "Approve Plan"));
    await waitFor(() =>
      expect(container.textContent).toContain(
        "This run already moved on. Showing the latest.",
      ),
    );
    // The page asks the server for the run again, so the reader sees its latest status.
    expect(
      requests.filter((r) => r.method === "GET" && r.path.endsWith("/run-1")),
    ).not.toHaveLength(0);
    expect(container.querySelector("#run-error")).toBeNull();
  });

  it("shows any other failure as the error line, with the server's message", async () => {
    const { container } = renderRunPage("awaiting_plan_approval", () =>
      json({ error: "The worker is busy. Try again." }, 500),
    );
    fireEvent.click(await waitForButton(container, "Approve Plan"));
    await waitFor(() =>
      expect(container.querySelector("#run-error")?.textContent).toBe(
        "The worker is busy. Try again.",
      ),
    );
    expect(container.textContent).not.toContain("already moved on");
  });
});

describe("Start New Run on a finished ticket", () => {
  it("creates the run from the same ticket and plan, then opens it", async () => {
    const { container, requests, router } = renderRunPage("failed", () =>
      json(makeRun("planning", { id: "run-2" })),
    );
    fireEvent.click(await waitForButton(container, "Start New Run"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/runs/run-2"),
    );
    const create = writesOf(requests).find((r) => r.path === "/api/runs");
    expect(create?.body).toEqual({
      projectId: "p",
      ticketId: "T-1",
      ticketTitle: "A ticket",
      acceptanceCriteria: [],
      plan: "1. Read the parser.",
    });
  });

  it("opens the run that already holds the ticket instead of creating one", async () => {
    const { container, router } = renderRunPage("failed", () =>
      json(
        {
          error: "This ticket already has an active run.",
          code: "RUN_ALREADY_ACTIVE",
          runId: "run-9",
        },
        409,
      ),
    );
    fireEvent.click(await waitForButton(container, "Start New Run"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/runs/run-9"),
    );
  });

  it("keeps this run and shows the error when the new run cannot start", async () => {
    const { container, router } = renderRunPage("failed", () =>
      json({ error: "The project has no repository." }, 500),
    );
    fireEvent.click(await waitForButton(container, "Start New Run"));
    await waitFor(() =>
      expect(container.querySelector("#run-error")?.textContent).toBe(
        "The project has no repository.",
      ),
    );
    expect(router.state.location.pathname).toBe("/runs/run-1");
  });
});

/** Waits for a checkpoint button to be on the page, then returns it. */
async function waitForButton(
  container: HTMLElement,
  name: string,
): Promise<HTMLButtonElement> {
  await waitFor(() => within(container).getByRole("button", { name }));
  return button(container, name);
}
