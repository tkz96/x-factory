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
  // The control vocabulary (#251): every block the screens are built from.
  "shared/controls.css",
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
      ".ui-icon-button",
      ".ui-button--danger",
      ".form-input",
      ".ui-button",
      ".ui-segment",
      ".ui-switch",
      ".ui-field-input",
      ".ui-badge",
      ".ui-badge--id",
      ".ui-list-row",
      ".ui-placeholder-line",
      "input,",
      "textarea,",
      "select,",
      ".filter-pill",
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

/** Every component-local stylesheet (overlays, diagrams, runs, docs ...), not the shared styles. */
function componentLocalStylesheets(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === STYLES ? [] : componentLocalStylesheets(full);
    }
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

/** Class names that name a control, badge, pill, field or tooltip surface. */
const CONTROL_CLASS =
  /(btn|button|input|field|search|select|toggle|switch|tab|pill|segment|close|trigger|tool|option|menu-item|badge|link|chip|tooltip)/;

describe("forced colours: component-local controls (#249)", () => {
  test("every component-local control class with a custom colour has a forced-colors rule", () => {
    const missing: string[] = [];
    for (const file of componentLocalStylesheets(
      path.join(ROOT, "src/frontend"),
    )) {
      const text = fs
        .readFileSync(file, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (rule[1] ?? "").trim();
        const body = rule[2] ?? "";
        if (selector.startsWith("@")) continue;
        const coloured =
          /\b(background|background-color|border|border-color|outline-color)\s*:\s*[^;]*(var\(--|#|rgba?\()/.test(
            body,
          );
        if (!coloured) continue;
        for (const cls of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          const name = cls[1] ?? "";
          if (CONTROL_CLASS.test(name) && !forcedColors.includes(`.${name}`)) {
            missing.push(`${path.relative(ROOT, file)}: .${name}`);
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

    // The Theme choice is a segmented control (#266): the focusable radio sits
    // inside its segment, and the segment is what shows the focus ring. Only the
    // chosen segment is a tab stop, so the test focuses the chosen one (Default).
    const radio = page.getByRole("radio", { name: "Default Theme" });
    await radio.waitFor();
    const control = page.locator(".ui-segment", { has: radio });
    // Keyboard focus, so :focus-visible applies as it does for a keyboard user.
    await radio.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await radio.evaluate((el) => el === document.activeElement)).toBe(
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

  test("the selected segment's label stays readable under forced colours", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`${instance.url}/runs`, { waitUntil: "load" });

    const selected = page.locator(".ui-segment[data-selected]").first();
    await selected.waitFor();
    // The browser paints a Canvas backplate behind forced-colour text; a
    // selected segment must not end up with its text colour on that backplate.
    const colours = await selected.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        text: cs.color,
        fill: cs.backgroundColor,
        adjust: cs.getPropertyValue("forced-color-adjust"),
      };
    });
    expect(colours.adjust).toBe("none");
    expect(colours.text).not.toBe(colours.fill);
    await context.close();
  }, 120_000);

  test("the current Settings category's label stays readable under forced colours", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`${instance.url}/settings?tab=general`, {
      waitUntil: "load",
    });
    const current = page.locator('.ui-nav-item[aria-current="page"]');
    await current.waitFor();
    const colours = await current.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        text: cs.color,
        fill: cs.backgroundColor,
        adjust: cs.getPropertyValue("forced-color-adjust"),
      };
    });
    expect(colours.adjust).toBe("none");
    expect(colours.text).not.toBe(colours.fill);
    await context.close();
  }, 120_000);
});
