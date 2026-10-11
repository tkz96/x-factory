// test/forced-colors.test.ts — Forced colours (#249). Static: every custom-coloured control,
// border, selection, status and focus ring has a forced-colors rule that uses system colour
// keywords. Emulated: in a real browser with forced colours on, focus and control boundaries
// stay visible on the Settings > General theme control.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { type Browser, chromium } from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const ROOT = path.resolve(import.meta.dir, "..");
const STYLES = path.join(ROOT, "src/frontend/styles");
const forcedColors = fs
  .readFileSync(path.join(STYLES, "forced-colors.css"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const SYSTEM_COLORS = [
  "Canvas",
  "CanvasText",
  "ButtonFace",
  "ButtonText",
  "ButtonBorder",
  "Field",
  "FieldText",
  "Highlight",
  "HighlightText",
  "LinkText",
  "GrayText",
];

/** Shared components and the Settings theme control, whose custom colours must be overridden. */
const CUSTOM_COLOURED_SOURCES = [
  "shared/buttons.css",
  "shared/badges.css",
  "shared/forms.css",
  "shared/cards.css",
  "../views/SettingsView.css",
];

describe("forced colours: static (#249)", () => {
  test("index.css imports the forced-colors layer last", () => {
    const index = fs.readFileSync(path.join(STYLES, "index.css"), "utf-8");
    const imports = [...index.matchAll(/@import "\.\/([^"]+)";/g)].map(
      (m) => m[1],
    );
    expect(imports.at(-1)).toBe("forced-colors.css");
  });

  test("the forced-colors block is gated on forced-colors: active", () => {
    expect(forcedColors).toContain("@media (forced-colors: active)");
  });

  test("the block uses system colour keywords for colour, not custom values", () => {
    for (const keyword of SYSTEM_COLORS) {
      expect(forcedColors).toContain(keyword);
    }
    expect(forcedColors).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(forcedColors).not.toMatch(/rgba?\(/i);
  });

  test("the block covers focus rings, selection, links and every shared control", () => {
    for (const selector of [
      ":focus-visible",
      "::selection",
      "a {",
      "button,",
      ".btn-primary",
      ".btn-secondary",
      ".btn-danger",
      ".theme-segment-btn",
      "input,",
      "textarea,",
      "select,",
      ".badge,",
      ".card,",
    ]) {
      expect(forcedColors).toContain(selector);
    }
  });

  test("every custom-coloured shared component class has a forced-colors rule", () => {
    const missing: string[] = [];
    for (const source of CUSTOM_COLOURED_SOURCES) {
      const text = fs
        .readFileSync(path.join(STYLES, source), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (rule[1] ?? "").trim();
        const body = rule[2] ?? "";
        if (selector.startsWith("@")) continue;
        // Controls, borders, status fills and focus rings: not plain text colour.
        const coloured =
          /\b(background|background-color|border|border-color|outline-color)\s*:\s*[^;]*(var\(--|#|rgba?\()/.test(
            body,
          );
        if (!coloured) continue;
        for (const cls of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          const name = cls[1] ?? "";
          if (!forcedColors.includes(`.${name}`)) {
            missing.push(`${source}: .${name}`);
          }
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("forced colours: emulated in a browser (#249)", () => {
  let instance: Awaited<ReturnType<typeof startIsolatedInstance>>;
  let browser: Browser;

  beforeAll(async () => {
    instance = await startIsolatedInstance();
    try {
      browser = await chromium.launch();
    } catch {
      browser = await chromium.launch({ channel: "chrome" });
    }
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await instance?.stop();
  });

  test("focus and control boundaries stay visible under forced colours", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`${instance.url}/settings?tab=general`, {
      waitUntil: "load",
    });

    const control = page.getByRole("button", { name: "Graphite Theme" });
    await control.waitFor();
    // Keyboard focus, so :focus-visible applies as it does for a keyboard user.
    await control.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await control.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );

    const style = await control.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        borderStyle: cs.borderTopStyle,
        borderWidth: cs.borderTopWidth,
      };
    });

    expect(style.outlineStyle).toBe("solid");
    expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);
    expect(style.borderStyle).toBe("solid");
    expect(parseFloat(style.borderWidth)).toBeGreaterThan(0);
    await context.close();
  }, 120_000);
});
