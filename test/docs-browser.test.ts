// test/docs-browser.test.ts — Docs and API Reference in a real browser (spec #241,
// ticket #270). Behaviour only: what a phone-width reader can reach and read,
// what the API Reference shows in each appearance, and that its toggle works.
// Layout is measured with real geometry, not class names.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright-core";
import {
  type IsolatedInstance,
  startIsolatedInstance,
} from "../scripts/screenshots/instance.js";

const TIMEOUT = 240_000;
const SETTLE_MS = 300;

let instance: IsolatedInstance;
let browser: Browser;
let origin: string;

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

/** Relative luminance of a `rgb(r, g, b)` string, 0 (black) to 1 (white). */
function luminance(rgb: string): number {
  const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe("Docs at phone width", () => {
  beforeAll(async () => {
    instance = await startIsolatedInstance();
    origin = new URL(instance.url).origin;
    browser = await launchBrowser();
  }, TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    await instance?.stop();
  });

  test(
    "the header lays out without the Browse button covering the breadcrumb",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(`${origin}/docs`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);

      const boxes = await page.evaluate(() => {
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        return {
          crumb: rect(".docs-header-crumb-current"),
          button: rect(".toolbar-actions .mobile-only"),
        };
      });
      expect(boxes.crumb).not.toBeNull();
      expect(boxes.button).not.toBeNull();
      if (!boxes.crumb || !boxes.button) return;
      // The button sits in its own row below the breadcrumb.
      expect(boxes.button.top).toBeGreaterThanOrEqual(boxes.crumb.bottom - 1);
      await context.close();
    },
    TIMEOUT,
  );

  test(
    "the article ends above the tab bar once the reader reaches the bottom",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(`${origin}/docs`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(() => {
        const main = document.getElementById("app-main");
        if (main) main.scrollTop = main.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await page.waitForTimeout(SETTLE_MS);

      const gap = await page.evaluate(() => {
        const tabBar = document.getElementById("mobile-tab-bar");
        const article = document.querySelector(".docs-reading-pane");
        if (!tabBar || !article) return Number.NaN;
        return (
          tabBar.getBoundingClientRect().top -
          article.getBoundingClientRect().bottom
        );
      });
      expect(Number.isNaN(gap)).toBe(false);
      expect(gap).toBeGreaterThanOrEqual(0);
      await context.close();
    },
    TIMEOUT,
  );

  test(
    "Browse documents opens the document list and its close control shuts it",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page: Page = await context.newPage();
      await page.goto(`${origin}/docs`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      const toggle = page.getByRole("button", { name: /browse documents/i });
      await toggle.click();
      expect(await toggle.getAttribute("aria-expanded")).toBe("true");
      await page.getByRole("button", { name: /close document list/i }).click();
      expect(await toggle.getAttribute("aria-expanded")).toBe("false");
      await context.close();
    },
    TIMEOUT,
  );
});

describe("API Reference follows the app's appearance", () => {
  beforeAll(async () => {
    instance = await startIsolatedInstance();
    origin = new URL(instance.url).origin;
    browser = await launchBrowser();
  }, TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    await instance?.stop();
  });

  test(
    "a dark appearance chosen in the app is dark on the reference page",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "light",
      });
      await context.addInitScript(() => {
        localStorage.setItem("xf_appearance", "dark");
      });
      const page = await context.newPage();
      await page.goto(`${origin}/reference`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      const attrs = await page.evaluate(() => ({
        appearance: document.documentElement.getAttribute("data-appearance"),
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      expect(attrs.appearance).toBe("dark");
      expect(luminance(attrs.bg)).toBeLessThan(0.05);
      await context.close();
    },
    TIMEOUT,
  );

  test(
    "the appearance toggle switches the page and keeps the choice",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "light",
      });
      const page = await context.newPage();
      await page.goto(`${origin}/reference`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      const before = await page.evaluate(() =>
        document.documentElement.getAttribute("data-appearance"),
      );
      await page
        .getByRole("button", { name: /switch between light and dark/i })
        .click();
      const after = await page.evaluate(() =>
        document.documentElement.getAttribute("data-appearance"),
      );
      expect(after).not.toBe(before);
      const stored = await page.evaluate(() =>
        localStorage.getItem("xf_appearance"),
      );
      expect(stored).toBe(after);
      await context.close();
    },
    TIMEOUT,
  );

  test(
    "the reference page renders with no network access beyond X-Factory",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const offOrigin: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).origin !== origin)
          offOrigin.push(request.url());
      });
      await page.goto(`${origin}/reference`, { waitUntil: "load" });
      await page.waitForFunction(
        () =>
          (document.querySelector("#scalar-target")?.innerHTML.length ?? 0) >
          2000,
      );
      expect(offOrigin).toEqual([]);
      await context.close();
    },
    TIMEOUT,
  );
});
