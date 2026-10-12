// test/shortcut-registry.test.ts — The shortcut registry and its matching rules (#254).
// Every shortcut is defined once; menus, the palette and the ? sheet read from it.

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, test } from "bun:test";
import {
  eventMatchesStep,
  isTextEntryTarget,
} from "../src/frontend/shortcuts/match.js";
import {
  formatShortcut,
  getShortcut,
  isMacPlatform,
  OVERRIDABLE_BINDINGS,
  RESERVED_BINDINGS,
  SHORTCUTS,
} from "../src/frontend/shortcuts/registry.js";

const base = {
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

afterAll(async () => {
  await unregisterHappyDom();
});

describe("shortcut registry (#254)", () => {
  test("every shortcut has a unique id and a visible alternative", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(s.alternative.trim().length).toBeGreaterThan(0);
    }
  });

  test("no two shortcuts share a key sequence", () => {
    const bound = SHORTCUTS.filter((s) => s.steps.length > 0).map((s) =>
      s.steps.join(" "),
    );
    expect(new Set(bound).size).toBe(bound.length);
  });

  test("no shortcut uses a combination the browser or OS reserves", () => {
    for (const s of SHORTCUTS) {
      expect(RESERVED_BINDINGS).not.toContain(s.steps.join(" "));
    }
  });

  test("the only overlap with overridable browser shortcuts is Mod+K", () => {
    const used = SHORTCUTS.flatMap((s) => s.steps);
    const overlaps = used.filter((step) => OVERRIDABLE_BINDINGS.includes(step));
    expect(overlaps).toEqual(["mod+k"]);
  });

  test("Stop Run has no chord and is offered through the palette", () => {
    const stop = getShortcut("stopRun");
    expect(stop.steps).toEqual([]);
    expect(stop.alternative).toContain("Command palette");
    expect(formatShortcut(stop, true)).toBeNull();
  });

  test("labels render per platform: ⌘ on macOS, Ctrl elsewhere", () => {
    const palette = getShortcut("palette");
    expect(formatShortcut(palette, true)).toBe("⌘K");
    expect(formatShortcut(palette, false)).toBe("Ctrl+K");
    expect(formatShortcut(getShortcut("goQueue"), false)).toBe("G then T");
    expect(formatShortcut(getShortcut("close"), true)).toBe("Esc");
    expect(formatShortcut(getShortcut("openItem"), true)).toBe("Return");
    expect(formatShortcut(getShortcut("openItem"), false)).toBe("Enter");
  });

  test("Mod matches ⌘ on macOS and Ctrl elsewhere, never the other", () => {
    const cmdK = { ...base, key: "k", metaKey: true };
    const ctrlK = { ...base, key: "k", ctrlKey: true };
    expect(eventMatchesStep(cmdK, "mod+k", true)).toBe(true);
    expect(eventMatchesStep(ctrlK, "mod+k", true)).toBe(false);
    expect(eventMatchesStep(ctrlK, "mod+k", false)).toBe(true);
    expect(eventMatchesStep(cmdK, "mod+k", false)).toBe(false);
  });

  test("single keys do not match while a modifier is held", () => {
    const ctrlN = { ...base, key: "n", ctrlKey: true };
    expect(eventMatchesStep(ctrlN, "n", false)).toBe(false);
  });

  test("? matches the question-mark key even when Shift is held", () => {
    const question = { ...base, key: "?", shiftKey: true };
    expect(eventMatchesStep(question, "?", false)).toBe(true);
  });

  test("text fields take typed keys; buttons and the body do not", () => {
    const input = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(checkbox)).toBe(false);
    expect(isTextEntryTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("button"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("platform detection and Mod on non-Mac systems (#254)", () => {
  const macUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15";
  const ev = (key: string, mods: object) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  test("a Mac platform is Mac", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: macUa })).toBe(
      true,
    );
    expect(isMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isMacPlatform({ platform: "iPhone", userAgent: "" })).toBe(true);
  });

  test("a Linux platform wins over a Macintosh user agent (Playwright WebKit on Linux)", () => {
    expect(isMacPlatform({ platform: "Linux x86_64", userAgent: macUa })).toBe(
      false,
    );
    expect(isMacPlatform({ platform: "Win32", userAgent: macUa })).toBe(false);
  });

  test("the user agent is the fallback when no platform is reported", () => {
    expect(isMacPlatform({ platform: "", userAgent: macUa })).toBe(true);
    expect(isMacPlatform({})).toBe(false);
  });

  test("off Mac, Ctrl+Enter and Ctrl+K match and Meta does not", () => {
    expect(
      eventMatchesStep(ev("Enter", { ctrlKey: true }), "mod+enter", false),
    ).toBe(true);
    expect(eventMatchesStep(ev("k", { ctrlKey: true }), "mod+k", false)).toBe(
      true,
    );
    expect(
      eventMatchesStep(ev("Enter", { metaKey: true }), "mod+enter", false),
    ).toBe(false);
  });
});
