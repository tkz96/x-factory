// test/notification-center.test.tsx — The toolbar bell, the activity area and the
// read state they share (#264, spec #241). Behaviour as a user sees it: what is
// listed, what the bell announces, what a click does, what survives a reload.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { NotificationActivity } from "../src/frontend/components/notifications/NotificationActivity.js";
import { NotificationBell } from "../src/frontend/components/notifications/NotificationBell.js";
import { NotificationProvider } from "../src/frontend/context/NotificationContext.js";
import type { AppEventTransport } from "../src/frontend/lib/app-events.js";
import { READ_STATE_STORAGE_KEY } from "../src/frontend/lib/notifications.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunStatus,
} from "../src/shared/types.js";

const realFetch = globalThis.fetch;
const TICKET = { id: "T-7", title: "Export CSV", acceptanceCriteria: [] };
const PROJECT = { id: "demo", name: "Demo App" };

afterAll(async () => {
  globalThis.fetch = realFetch;
  await unregisterHappyDom();
});

beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new Error("the snapshot is seeded, no request is expected");
  }) as unknown as typeof fetch;
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function envelope(id: number, runId: string, status: RunStatus, payload = {}): AppEventEnvelope {
  return {
    id,
    runId,
    sequence: id,
    type: "status",
    payload: { status, ...payload },
    time: new Date().toISOString(),
    ticket: { ...TICKET, id: `T-${runId}`, title: `Ticket ${runId}` },
    project: PROJECT,
  } as unknown as AppEventEnvelope;
}

function run(id: string, status: RunStatus): Run {
  return {
    id,
    project: PROJECT,
    ticket: { ...TICKET, id: `T-${id}`, title: `Ticket ${id}` },
    status,
    updatedAt: new Date().toISOString(),
  } as unknown as Run;
}

function snapshot(partial: Partial<EventsSnapshot> = {}): EventsSnapshot {
  return { cursor: 100, runs: [], needsYou: [], finished: [], ...partial };
}

/** A live stream the test drives by hand. */
function liveStream() {
  let deliver: (e: AppEventEnvelope) => void = () => {};
  const transport: AppEventTransport = (_cursor, handlers) => {
    deliver = (e) => handlers.onMessage(JSON.stringify(e));
    handlers.onOpen();
    return () => {};
  };
  return { transport, push: (e: AppEventEnvelope) => act(() => deliver(e)) };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderCenter(seed: EventsSnapshot, stream = liveStream()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.eventsSnapshot(), seed);
  const utils = render(
    <QueryClientProvider client={client}>
      <NotificationProvider transport={stream.transport}>
        <MemoryRouter initialEntries={["/tickets"]}>
          <NotificationBell />
          <NotificationActivity />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </NotificationProvider>
    </QueryClientProvider>,
  );
  return { ...utils, stream, push: stream.push };
}

// `screen` is built at import time, before happy-dom is registered; query at call time.
const view = () => within(document.body);

function bell() {
  return view().getByRole("button", { name: /^Notifications/ });
}

/** The bell's name as a screen reader hears it, even while a popover hides the page. */
function bellLabel(): string | null {
  return view()
    .getByRole("button", { name: /^Notifications/, hidden: true })
    .getAttribute("aria-label");
}

describe("notification bell (#264)", () => {
  it("names the unread count on the bell and shows no count when nothing is waiting", () => {
    const { unmount } = renderCenter(snapshot());
    expect(bellLabel()).toBe("Notifications");
    unmount();

    renderCenter(
      snapshot({
        runs: [run("r1", "awaiting_plan_approval")],
        needsYou: [envelope(90, "r1", "awaiting_plan_approval")],
      }),
    );
    expect(bellLabel()).toBe("Notifications, 1 unread");
  });

  it("lists a Needs-you notification with its ticket and kind, and the empty state otherwise", async () => {
    renderCenter(snapshot());
    fireEvent.click(bell());
    expect(await view().findByText("No notifications yet.")).toBeTruthy();
  });

  it("a live plan-ready event is a new unread notification, and a second plan is another one", async () => {
    const { push } = renderCenter(snapshot({ runs: [run("r1", "planning")] }));
    push(envelope(101, "r1", "awaiting_plan_approval"));
    expect(bellLabel()).toBe("Notifications, 1 unread");

    push(envelope(102, "r1", "planning"));
    expect(bellLabel()).toBe("Notifications");

    push(envelope(103, "r1", "awaiting_plan_approval"));
    expect(bellLabel()).toBe("Notifications, 1 unread");
  });

  it("clicking a notification opens its run and marks it read", async () => {
    renderCenter(
      snapshot({
        runs: [run("r1", "awaiting_review")],
        needsYou: [envelope(110, "r1", "awaiting_review")],
      }),
    );
    fireEvent.click(bell());
    const item = await view().findByRole("button", { name: /Changes ready/ });
    fireEvent.click(item);

    expect(view().getByTestId("location").textContent).toBe("/runs/r1");
    expect(bellLabel()).toBe("Notifications");
  });

  it("Mark All as Read clears the unread count", async () => {
    renderCenter(
      snapshot({
        runs: [run("r1", "awaiting_plan_approval"), run("r2", "ready_for_pr")],
        needsYou: [
          envelope(120, "r1", "awaiting_plan_approval"),
          envelope(121, "r2", "ready_for_pr"),
        ],
      }),
    );
    expect(bellLabel()).toBe("Notifications, 2 unread");
    fireEvent.click(bell());
    fireEvent.click(await view().findByRole("button", { name: "Mark All as Read" }));
    expect(bellLabel()).toBe("Notifications");
  });

  it("keeps read state across a reload, keyed by event id", () => {
    const seed = snapshot({
      runs: [run("r1", "awaiting_plan_approval")],
      needsYou: [envelope(130, "r1", "awaiting_plan_approval")],
    });
    const first = renderCenter(seed);
    expect(bellLabel()).toBe("Notifications, 1 unread");
    fireEvent.click(bell());
    fireEvent.click(view().getByRole("button", { name: "Mark All as Read" }));
    first.unmount();

    expect(globalThis.localStorage?.getItem(READ_STATE_STORAGE_KEY)).toContain("130");
    renderCenter(seed);
    expect(bellLabel()).toBe("Notifications");
  });

  it("works when browser storage throws on every call: read state holds for the session only", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const seed = snapshot({
        runs: [run("r1", "ready_for_pr")],
        needsYou: [envelope(140, "r1", "ready_for_pr")],
      });
      const { push, unmount } = renderCenter(seed);
      expect(bellLabel()).toBe("Notifications, 1 unread");
      fireEvent.click(bell());
      fireEvent.click(view().getByRole("button", { name: "Mark All as Read" }));
      expect(bellLabel()).toBe("Notifications");

      push(envelope(141, "r1", "recovery_required"));
      expect(bellLabel()).toBe("Notifications, 1 unread");
      unmount();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("the activity area shows runs in progress and hides when none are", () => {
    const { push } = renderCenter(snapshot({ runs: [run("r1", "executing")] }));
    expect(view().getByRole("link", { name: /T-r1/ }).textContent).toContain("Writing code");

    push(envelope(150, "r1", "pr_created"));
    expect(view().queryByRole("link", { name: /T-r1/ })).toBeNull();
  });

  it("the activity area is never written to storage", () => {
    renderCenter(snapshot({ runs: [run("r1", "planning")] }));
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
    expect(view().getByRole("link", { name: /T-r1/ })).toBeTruthy();
  });
});
