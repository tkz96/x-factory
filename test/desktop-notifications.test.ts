// test/desktop-notifications.test.ts — Desktop notification support, permission, banner
// rules and wording (#265, spec #241). The Notifications API is stubbed, never real.

import { describe, expect, it } from "bun:test";
import {
  type BannerContext,
  bannerCopy,
  desktopSupport,
  desktopSupportReason,
  type NotificationApi,
  requestDesktopPermission,
  shouldOfferDesktopPrompt,
  shouldShowBanner,
} from "../src/frontend/lib/desktop-notifications.js";
import type { AppNotification } from "../src/frontend/lib/notifications.js";

function api(
  permission: string,
  requested: string = permission,
): NotificationApi {
  return {
    permission,
    requestPermission: () => Promise.resolve(requested),
  } as NotificationApi;
}

const NEEDS_YOU: AppNotification = {
  id: 42,
  runId: "run-1",
  ticketId: "ACME-7",
  ticketTitle: "Export CSV",
  projectName: "Demo App",
  status: "awaiting_plan_approval",
  group: "Needs you",
  text: "Plan ready",
  detail: null,
  time: "2026-10-11T00:00:00.000Z",
};

const FINISHED: AppNotification = {
  ...NEEDS_YOU,
  id: 43,
  status: "failed",
  group: "Finished",
  text: "Run failed",
  detail: "Tests failed",
};

const LIVE_UNFOCUSED: BannerContext = {
  live: true,
  enabled: true,
  support: "granted",
  documentFocused: false,
  openRunId: null,
};

describe("desktop support (#265)", () => {
  it("reports unsupported when the API is missing", () => {
    expect(desktopSupport(undefined)).toBe("unsupported");
  });

  it("reports blocked when permission was refused", () => {
    expect(desktopSupport(api("denied"))).toBe("blocked");
  });

  it("reports prompt when permission has not been decided", () => {
    expect(desktopSupport(api("default"))).toBe("prompt");
  });

  it("reports granted when permission is allowed", () => {
    expect(desktopSupport(api("granted"))).toBe("granted");
  });

  it("gives a one-line reason only when the switch cannot be turned on", () => {
    expect(desktopSupportReason("unsupported")).toMatch(/doesn't support/);
    expect(desktopSupportReason("blocked")).toMatch(/blocked/);
    expect(desktopSupportReason("prompt")).toBeNull();
    expect(desktopSupportReason("granted")).toBeNull();
  });

  it("asks for permission only when asked, and maps the answer", async () => {
    let asked = 0;
    const stub = {
      permission: "default",
      requestPermission: () => {
        asked += 1;
        return Promise.resolve("granted");
      },
    } as NotificationApi;
    expect(desktopSupport(stub)).toBe("prompt");
    expect(asked).toBe(0);
    expect(await requestDesktopPermission(stub)).toBe("granted");
    expect(asked).toBe(1);
  });

  it("maps the browser's answer to the prompt, and a failing prompt to its current state", async () => {
    expect(await requestDesktopPermission(api("default", "denied"))).toBe(
      "blocked",
    );
    const throwing = {
      permission: "default",
      requestPermission: () => Promise.reject(new Error("no")),
    } as NotificationApi;
    expect(await requestDesktopPermission(throwing)).toBe("prompt");
    expect(await requestDesktopPermission(undefined)).toBe("unsupported");
  });
});

describe("banner rules (#265, spec #241)", () => {
  const cases: [string, Partial<BannerContext>, boolean][] = [
    ["a live event in the background", {}, true],
    ["a replayed or snapshot event", { live: false }, false],
    ["a focused window", { documentFocused: true }, false],
    ["the run already on screen", { openRunId: "run-1" }, false],
    ["another run on screen", { openRunId: "run-2" }, true],
    ["the preference off", { enabled: false }, false],
    ["permission not granted", { support: "prompt" }, false],
  ];
  for (const [name, change, expected] of cases) {
    it(`${expected ? "fires" : "does not fire"} for ${name}`, () => {
      expect(
        shouldShowBanner(NEEDS_YOU, { ...LIVE_UNFOCUSED, ...change }),
      ).toBe(expected);
    });
  }

  it("fires for a Finished event under the same rules", () => {
    expect(shouldShowBanner(FINISHED, LIVE_UNFOCUSED)).toBe(true);
    expect(shouldShowBanner(FINISHED, { ...LIVE_UNFOCUSED, live: false })).toBe(
      false,
    );
  });
});

describe("banner wording never names an OS (#265)", () => {
  it("uses the notification's own text, ticket and project", () => {
    const copy = bannerCopy(NEEDS_YOU);
    expect(copy.title).toContain("Plan ready");
    expect(copy.title).toContain("ACME-7");
    expect(copy.body).toContain("Export CSV");
    expect(copy.body).toContain("Demo App");
  });

  it("carries the failure reason for a failed run", () => {
    expect(bannerCopy(FINISHED).body).toContain("Tests failed");
  });

  it("never names macOS, Windows, Linux or an OS settings app", () => {
    for (const n of [NEEDS_YOU, FINISHED]) {
      const text =
        JSON.stringify(bannerCopy(n)) +
        (desktopSupportReason("blocked") ?? "") +
        (desktopSupportReason("unsupported") ?? "");
      expect(text).not.toMatch(
        /macOS|Mac\b|Windows|Linux|Notification Center|Action Center|System Settings|Ubuntu/i,
      );
    }
  });
});

describe("one-time bell prompt (#265)", () => {
  const base = {
    enabled: false,
    support: "prompt" as const,
    alreadyOffered: false,
    hasNeedsYou: true,
  };

  it("is offered once a run needs you, with permission undecided and the switch off", () => {
    expect(shouldOfferDesktopPrompt(base)).toBe(true);
  });

  it("is never offered on load, without a run that needs you", () => {
    expect(shouldOfferDesktopPrompt({ ...base, hasNeedsYou: false })).toBe(
      false,
    );
  });

  it("is not offered again once answered, or when already on, or when blocked or unsupported", () => {
    expect(shouldOfferDesktopPrompt({ ...base, alreadyOffered: true })).toBe(
      false,
    );
    expect(
      shouldOfferDesktopPrompt({ ...base, enabled: true, support: "granted" }),
    ).toBe(false);
    expect(shouldOfferDesktopPrompt({ ...base, support: "blocked" })).toBe(
      false,
    );
    expect(shouldOfferDesktopPrompt({ ...base, support: "unsupported" })).toBe(
      false,
    );
  });
});
