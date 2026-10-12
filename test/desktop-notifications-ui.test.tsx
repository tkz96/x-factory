// test/desktop-notifications-ui.test.tsx — Desktop notifications as a user sees them (#265,
// spec #241): the one-time bell row, the Settings switch, when a banner appears and what a
// click does. The Notifications API and window focus are stubbed.

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
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { DesktopBanners } from "../src/frontend/components/notifications/DesktopBanners.js";
import { NotificationBell } from "../src/frontend/components/notifications/NotificationBell.js";
import { DesktopNotificationsSetting } from "../src/frontend/components/settings/DesktopNotificationsSetting.js";
import { NotificationProvider } from "../src/frontend/context/NotificationContext.js";
import type { AppEventTransport } from "../src/frontend/lib/app-events.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunStatus,
  WorkbenchSettings,
} from "../src/shared/types.js";

const TICKET = { id: "T-7", title: "Export CSV", acceptanceCriteria: [] };
const PROJECT = { id: "demo", name: "Demo App" };
const ORIGINAL_NOTIFICATION = (globalThis as { Notification?: unknown })
  .Notification;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_HAS_FOCUS = document.hasFocus;

interface ShownBanner {
  title: string;
  body?: string | undefined;
  tag?: string | undefined;
  onclick: ((event: unknown) => void) | null;
  close: () => void;
}

/** A stand-in for the browser's Notification class; records what it is asked to show. */
class FakeNotification {
  static permission = "default";
  static requests = 0;
  static shown: ShownBanner[] = [];
  static requestPermission(): Promise<string> {
    FakeNotification.requests += 1;
    FakeNotification.permission = "granted";
    return Promise.resolve("granted");
  }
  onclick: ((event: unknown) => void) | null = null;
  title: string;
  body?: string | undefined;
  tag?: string | undefined;
  constructor(title: string, options?: { body?: string; tag?: string }) {
    this.title = title;
    this.body = options?.body;
    this.tag = options?.tag;
    FakeNotification.shown.push(this as unknown as ShownBanner);
  }
  close() {}
}

let focusCalls = 0;
let settingsBodies: Partial<WorkbenchSettings>[] = [];
let serverSettings: WorkbenchSettings = { desktopNotifications: false };

beforeEach(() => {
  FakeNotification.permission = "default";
  FakeNotification.requests = 0;
  FakeNotification.shown = [];
  focusCalls = 0;
  settingsBodies = [];
  serverSettings = { desktopNotifications: false };
  (globalThis as { Notification?: unknown }).Notification = FakeNotification;
  document.hasFocus = () => false;
  window.focus = () => {
    focusCalls += 1;
  };
  globalThis.localStorage?.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/settings")) {
      if (init?.method === "POST") {
        const body = JSON.parse(
          String(init.body),
        ) as Partial<WorkbenchSettings>;
        settingsBodies.push(body);
        serverSettings = { ...serverSettings, ...body };
      }
      return new Response(JSON.stringify(serverSettings), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected request ${String(input)}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  document.hasFocus = ORIGINAL_HAS_FOCUS;
  (globalThis as { Notification?: unknown }).Notification =
    ORIGINAL_NOTIFICATION;
});

afterAll(async () => {
  await unregisterHappyDom();
});

function envelope(
  id: number,
  runId: string,
  status: RunStatus,
): AppEventEnvelope {
  return {
    id,
    runId,
    sequence: id,
    type: "status",
    payload: { status },
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

function renderApp(
  seed: EventsSnapshot,
  options: { route?: string; settings?: WorkbenchSettings } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.eventsSnapshot(), seed);
  const settings = options.settings ?? serverSettings;
  serverSettings = settings;
  client.setQueryData(queryKeys.settings(), settings);
  const stream = liveStream();
  const utils = render(
    <QueryClientProvider client={client}>
      <NotificationProvider transport={stream.transport}>
        <MemoryRouter initialEntries={[options.route ?? "/tickets"]}>
          <NotificationBell />
          <DesktopBanners />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </NotificationProvider>
    </QueryClientProvider>,
  );
  return { ...utils, push: stream.push };
}

const view = () => within(document.body);
const bell = () => view().getByRole("button", { name: /^Notifications/ });
const location = () => view().getByTestId("location").textContent;

describe("desktop notifications: the bell's one-time row (#265)", () => {
  it("offers the row while permission is undecided, even with no run waiting, and asks for nothing on load", async () => {
    renderApp(snapshot());
    fireEvent.click(bell());
    expect(await view().findByText("No notifications yet.")).toBeTruthy();
    expect(
      view().getByText("Get desktop notifications when a run needs you"),
    ).toBeTruthy();
    expect(FakeNotification.requests).toBe(0);
  });

  it("requests permission only from Enable, and then turns the preference on", async () => {
    renderApp(
      snapshot({
        runs: [run("r1", "awaiting_plan_approval")],
        needsYou: [envelope(90, "r1", "awaiting_plan_approval")],
      }),
    );
    fireEvent.click(bell());
    expect(
      await view().findByText("Get desktop notifications when a run needs you"),
    ).toBeTruthy();
    expect(FakeNotification.requests).toBe(0);

    fireEvent.click(view().getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(settingsBodies).toEqual([{ desktopNotifications: true }]),
    );
    expect(FakeNotification.requests).toBe(1);
  });

  it("is one-time: Not Now hides it, and it stays hidden after a reload", async () => {
    const seed = snapshot({
      runs: [run("r1", "awaiting_plan_approval")],
      needsYou: [envelope(90, "r1", "awaiting_plan_approval")],
    });
    const first = renderApp(seed);
    fireEvent.click(bell());
    fireEvent.click(await view().findByRole("button", { name: "Not Now" }));
    expect(view().queryByText(/Get desktop notifications/)).toBeNull();
    first.unmount();

    renderApp(seed);
    fireEvent.click(bell());
    await view().findByText("Plan ready");
    expect(view().queryByRole("button", { name: "Not Now" })).toBeNull();
    expect(view().queryByText(/Get desktop notifications/)).toBeNull();
    expect(FakeNotification.requests).toBe(0);
  });
});

describe("desktop notifications: banners (#265, spec #241)", () => {
  const preferenceOn = { desktopNotifications: true };

  it("fires for a live Needs-you event when the window is unfocused and the run isn't on screen", () => {
    FakeNotification.permission = "granted";
    const { push } = renderApp(snapshot({ runs: [run("r1", "planning")] }), {
      settings: preferenceOn,
    });
    push(envelope(101, "r1", "awaiting_plan_approval"));
    expect(FakeNotification.shown.length).toBe(1);
    expect(FakeNotification.shown[0]?.title).toContain("Plan ready");
    expect(FakeNotification.shown[0]?.title).toContain("T-r1");
  });

  it("fires once when a run newly needs you, not when it moves between Needs-you statuses", () => {
    FakeNotification.permission = "granted";
    const { push } = renderApp(snapshot({ runs: [run("r1", "planning")] }), {
      settings: preferenceOn,
    });
    push(envelope(101, "r1", "awaiting_plan_approval"));
    expect(FakeNotification.shown.length).toBe(1);
    push(envelope(102, "r1", "awaiting_review"));
    expect(FakeNotification.shown.length).toBe(1);
    push(envelope(103, "r1", "executing"));
    push(envelope(104, "r1", "awaiting_review"));
    expect(FakeNotification.shown.length).toBe(2);
  });

  it("fires when a run already waiting in the snapshot finishes", () => {
    FakeNotification.permission = "granted";
    const { push } = renderApp(
      snapshot({
        runs: [run("r1", "awaiting_review")],
        needsYou: [envelope(90, "r1", "awaiting_review")],
      }),
      { settings: preferenceOn },
    );
    push(envelope(101, "r1", "pr_created"));
    expect(FakeNotification.shown.length).toBe(1);
  });

  it("never fires for events seeded from the snapshot", () => {
    FakeNotification.permission = "granted";
    renderApp(
      snapshot({
        runs: [run("r1", "awaiting_plan_approval")],
        needsYou: [envelope(90, "r1", "awaiting_plan_approval")],
      }),
      { settings: preferenceOn },
    );
    expect(FakeNotification.shown.length).toBe(0);
  });

  it("stays silent when the preference is off, permission is not granted, or the window has focus", () => {
    FakeNotification.permission = "granted";
    const off = renderApp(snapshot({ runs: [run("r1", "planning")] }), {
      settings: { desktopNotifications: false },
    });
    off.push(envelope(101, "r1", "awaiting_plan_approval"));
    off.unmount();

    FakeNotification.permission = "default";
    const unpermitted = renderApp(snapshot({ runs: [run("r2", "planning")] }), {
      settings: preferenceOn,
    });
    unpermitted.push(envelope(102, "r2", "awaiting_plan_approval"));
    unpermitted.unmount();

    FakeNotification.permission = "granted";
    document.hasFocus = () => true;
    const focused = renderApp(snapshot({ runs: [run("r3", "planning")] }), {
      settings: preferenceOn,
    });
    focused.push(envelope(103, "r3", "awaiting_plan_approval"));
    expect(FakeNotification.shown.length).toBe(0);
  });

  it("stays silent for the run the user is already looking at", () => {
    FakeNotification.permission = "granted";
    const { push } = renderApp(snapshot({ runs: [run("r1", "planning")] }), {
      settings: preferenceOn,
      route: "/runs/r1",
    });
    push(envelope(101, "r1", "awaiting_plan_approval"));
    expect(FakeNotification.shown.length).toBe(0);
  });

  it("a click focuses the window and opens that run", () => {
    FakeNotification.permission = "granted";
    const { push } = renderApp(snapshot({ runs: [run("r1", "planning")] }), {
      settings: preferenceOn,
    });
    push(envelope(101, "r1", "awaiting_plan_approval"));
    const banner = FakeNotification.shown[0];
    expect(banner).toBeDefined();
    act(() => banner?.onclick?.({}));
    expect(focusCalls).toBe(1);
    expect(location()).toBe("/runs/r1");
  });
});

describe("desktop notifications: the Settings switch (#265)", () => {
  function renderSwitch(settings: WorkbenchSettings) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.settings(), settings);
    serverSettings = settings;
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DesktopNotificationsSetting />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("is off by default and asks for permission only when switched on", async () => {
    renderSwitch({ desktopNotifications: false });
    const toggle = view().getByRole("switch", {
      name: "Desktop notifications",
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(FakeNotification.requests).toBe(0);

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(settingsBodies).toEqual([{ desktopNotifications: true }]),
    );
    expect(FakeNotification.requests).toBe(1);
  });

  it("switching off saves the preference off and never asks the browser", async () => {
    FakeNotification.permission = "granted";
    renderSwitch({ desktopNotifications: true });
    const toggle = view().getByRole("switch", {
      name: "Desktop notifications",
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(settingsBodies).toEqual([{ desktopNotifications: false }]),
    );
    expect(FakeNotification.requests).toBe(0);
  });

  it("is disabled with a one-line reason when the API is missing", () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    renderSwitch({ desktopNotifications: false });
    const toggle = view().getByRole("switch", {
      name: "Desktop notifications",
    });
    expect(
      toggle.hasAttribute("disabled") ||
        toggle.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(
      view().getByText(/doesn't support desktop notifications/),
    ).toBeTruthy();
  });

  it("is disabled with a reason when permission is blocked, and never names an OS", () => {
    FakeNotification.permission = "denied";
    renderSwitch({ desktopNotifications: false });
    const toggle = view().getByRole("switch", {
      name: "Desktop notifications",
    });
    expect(
      toggle.hasAttribute("disabled") ||
        toggle.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    const reason = view().getByText(/blocked for this site/);
    expect(reason.textContent).not.toMatch(
      /macOS|Windows|Linux|System Settings|Notification Center/,
    );
  });
});
