// test/theme-fonts-load.test.ts — Theme fonts load only when their theme is active (#249).
// The Graphite and Sandstone faces are declared in tokens.css, but a browser only
// fetches a face a page uses. This drives the real app in Chromium and records the
// font requests: a fresh profile on the Default theme requests none of them, and
// choosing Graphite requests its face.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium } from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const TIMEOUT = 240_000;
/** Graphite's face (IBM Plex Sans) and Sandstone's face (Atkinson Hyperlegible Next). */
const THEME_FONT = /\/fonts\/(IBMPlexSans|AtkinsonHyperlegible(Next|Mono))-/;

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
    "the Default theme requests no Graphite or Sandstone font, and Graphite requests its own",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const fontRequests: string[] = [];
      page.on("request", (request) => {
        if (THEME_FONT.test(new URL(request.url()).pathname)) {
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
      expect(fontRequests.some((path) => path.includes("IBMPlexSans-"))).toBe(
        true,
      );
      await context.close();
    },
    TIMEOUT,
  );
});
