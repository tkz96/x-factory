// test/theme-fonts-load.test.ts — Theme fonts load only when their setting is on (#249, spec #292).
// Themes change colour only, so no theme requests a font. The Readable font
// (Atkinson Hyperlegible) is the only extra face, and a browser fetches it only
// when text uses it. This drives the real app in Chromium and records the font
// requests: a fresh profile requests none of them, and switching theme requests none.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium } from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const TIMEOUT = 240_000;
/** The Readable font faces (Atkinson Hyperlegible Next and Mono). */
const READABLE_FONT = /\/fonts\/AtkinsonHyperlegible(Next|Mono)-/;

describe("theme fonts load only when active (#249)", () => {
  let instance: Awaited<ReturnType<typeof startIsolatedInstance>>;
  let browser: Browser;

  beforeAll(async () => {
    instance = await startIsolatedInstance();
    try {
      browser = await chromium.launch();
    } catch {
      browser = await chromium.launch({ channel: "chrome" });
    }
  }, TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    await instance?.stop();
  });

  test(
    "no theme requests a font file, and switching to Graphite requests none",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const fontRequests: string[] = [];
      page.on("request", (request) => {
        if (READABLE_FONT.test(new URL(request.url()).pathname)) {
          fontRequests.push(new URL(request.url()).pathname);
        }
      });

      await page.goto(`${instance.url}/settings?tab=general`, {
        waitUntil: "load",
      });
      await page.getByRole("radio", { name: "Default Theme" }).waitFor();
      await page.waitForLoadState("networkidle");
      expect(
        await page.evaluate(() => document.documentElement.dataset.theme),
      ).toBe("default");
      expect(fontRequests).toEqual([]);

      // The radio is visually hidden inside its segment; the segment is the target.
      await page
        .locator(".ui-segment", {
          has: page.getByRole("radio", { name: "Graphite Theme" }),
        })
        .click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "graphite",
      );
      await page.waitForLoadState("networkidle");
      expect(fontRequests).toEqual([]);
      await context.close();
    },
    TIMEOUT,
  );
});
