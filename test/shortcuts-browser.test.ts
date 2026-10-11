// test/shortcuts-browser.test.ts — Keyboard handling in real browsers (#254).
//
// Playwright keyboard input in Chromium, Firefox and WebKit checks the app's own
// handling: what opens, what navigates, what is ignored in text fields, and that
// the palette and the Search button are the same thing. These tests prove app
// behaviour only. What a browser does with the same keys is checked by hand (the
// shortcut checklist in the PR), so a passing run here is not that verification.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Browser,
  chromium,
  firefox,
  type Page,
  webkit,
} from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const ENGINES = [
  { name: "chromium", engine: chromium },
  { name: "firefox", engine: firefox },
  { name: "webkit", engine: webkit },
] as const;

let instance: Awaited<ReturnType<typeof startIsolatedInstance>>;

beforeAll(async () => {
  instance = await startIsolatedInstance();
}, 300_000);

afterAll(async () => {
  await instance?.stop();
});

async function openPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${instance.url}${path}`, { waitUntil: "load" });
  await page.waitForSelector("#app-shell");
  return page;
}

for (const { name, engine } of ENGINES) {
  describe(`keyboard shortcuts in ${name} (#254)`, () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await engine.launch();
    }, 240_000);

    afterAll(async () => {
      await browser?.close();
    });

    test("Mod+K and the Search button open the same palette", async () => {
      const page = await openPage(browser, "/queue");
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await page.keyboard.press(`${MOD}+k`);
      await palette.waitFor();
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "detached" });

      await page.locator("#btn-search").click();
      await palette.waitFor();
      const focusedRole = await page.evaluate(() =>
        document.activeElement?.getAttribute("role"),
      );
      expect(focusedRole).toBe("combobox");
    });

    test("G then T and G then R move between sections", async () => {
      const page = await openPage(browser, "/runs");
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await page.keyboard.press("g");
      await page.keyboard.press("t");
      await page.waitForURL(/\/queue$/);
      await page.keyboard.press("g");
      await page.keyboard.press("r");
      await page.waitForURL(/\/runs$/);
    });

    test("single keys are ignored while a text field has focus", async () => {
      const page = await openPage(browser, "/queue");
      const search = page.locator("#queue-search");
      await search.focus();
      await page.keyboard.type("gr?n");
      expect(new URL(page.url()).pathname).toBe("/queue");
      expect(await search.inputValue()).toBe("gr?n");
      expect(
        await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count(),
      ).toBe(0);
    });

    test("/ focuses the page search; ? opens the shortcut sheet; Esc closes it", async () => {
      const page = await openPage(browser, "/queue");
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await page.keyboard.press("/");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        "queue-search",
      );
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await page.keyboard.type("?");
      const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await sheet.waitFor();
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });
    });
  });
}
