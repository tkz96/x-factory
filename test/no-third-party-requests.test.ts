// test/no-third-party-requests.test.ts — The browser's own proof for spec #241,
// ticket #247: drive every screen of the app, and the API Reference, in a real
// browser and fail on any request to a host that is not X-Factory's own origin.
//
// Requests made from JavaScript pass through the same interception: fetch,
// EventSource, a lazy dynamic import or an image built in code all show up as
// `request` events. The static scan in test/frontend-smoke.test.ts reads what
// the sources declare; this test proves what the page actually asks for.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright-core";
import {
  type IsolatedInstance,
  startIsolatedInstance,
} from "../scripts/screenshots/instance.js";
import { resolveScreenPath, SCREENS } from "../scripts/screenshots/matrix.js";

const TIMEOUT = 240_000;
const SETTLE_MS = 300;

let instance: IsolatedInstance;
let browser: Browser;
let origin: string;

/**
 * The Chromium Playwright manages, or the system's Google Chrome — some
 * machines and CI images have one but not the other. Which binary runs is not
 * what this test is about; where the page sends its requests is.
 */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

/** Every request the page made to a host other than X-Factory's own. */
function watch(page: Page, offOrigin: string[]): void {
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) {
      offOrigin.push(
        `${request.resourceType()} ${request.method()} ${url.href}`,
      );
    }
  });
}

describe("no third-party requests", () => {
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
    "every screen loads without asking another host",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const offOrigin: string[] = [];
      watch(page, offOrigin);

      const visited: string[] = [];
      for (const screen of SCREENS) {
        const path = resolveScreenPath(screen, instance);
        visited.push(path);
        const response = await page.goto(`${origin}${path}`, {
          waitUntil: "load",
        });
        expect(response?.status()).toBe(200);
        // Let the shell settle: deferred queries and effects fire their own
        // requests after load.
        await page.waitForTimeout(SETTLE_MS);
      }

      // The list is the evidence matrix, so a screen added there is covered here.
      expect(visited).toEqual([
        "/runs",
        "/tickets",
        "/runs",
        "/runs?filter=done",
        `/runs/${instance.runId}`,
        "/projects",
        `/projects/${instance.projectId}`,
        "/settings",
        "/docs",
        "/reference",
      ]);
      expect(offOrigin).toEqual([]);
      await context.close();
    },
    TIMEOUT,
  );

  test(
    "the API Reference renders from X-Factory's own copy of the viewer",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const offOrigin: string[] = [];
      watch(page, offOrigin);

      const viewer = page.waitForResponse((response) =>
        response
          .url()
          .endsWith("/assets/api-reference/scalar-api-reference.min.js"),
      );
      const spec = page.waitForResponse((response) =>
        response.url().endsWith("/api/openapi.json"),
      );

      await page.goto(`${origin}/reference`, { waitUntil: "load" });
      expect((await viewer).status()).toBe(200);
      expect((await spec).status()).toBe(200);

      // The bundled viewer mounts itself into the page it was handed.
      await page.waitForFunction(
        () =>
          (document.querySelector("#scalar-target")?.innerHTML.length ?? 0) >
          2000,
      );
      const rendered = await page.textContent("#scalar-target");
      expect(rendered).toContain("X-Factory API");
      expect(rendered).toContain("/api/health");
      expect(
        await page.isVisible("#scalar-fallback"),
        "the offline fallback must stay hidden: the viewer loaded",
      ).toBe(false);

      await page.waitForTimeout(SETTLE_MS);
      expect(offOrigin).toEqual([]);
      await context.close();
    },
    TIMEOUT,
  );
  test(
    "no screen scrolls sideways at phone width (390 px)",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const overflowing: string[] = [];
      // Every screen, the API Reference included: the viewer is held to the
      // same rule as the app (spec #241, ticket #270).
      for (const screen of SCREENS) {
        const path = resolveScreenPath(screen, instance);
        await page.goto(`${origin}${path}`, { waitUntil: "load" });
        await page.waitForTimeout(SETTLE_MS);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        if (overflow > 0)
          overflowing.push(`${path} overflows by ${overflow}px`);
      }
      expect(overflowing).toEqual([]);
      await context.close();
    },
    TIMEOUT,
  );
});
