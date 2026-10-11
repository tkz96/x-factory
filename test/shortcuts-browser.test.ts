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

// Mod is whatever the page itself decides it is: the app reads the browser's
// reported platform, and Playwright's WebKit can differ from the host OS.
async function modKeyFor(page: Page): Promise<"Meta" | "Control"> {
  const isMac = await page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform =
      nav.userAgentData?.platform || nav.platform || nav.userAgent;
    return /mac|iphone|ipad/i.test(platform);
  });
  return isMac ? "Meta" : "Control";
}

// Page load under Linux WebKit on CI is slow, so tests that open a page get
// more than Bun's 5 s default.
const PAGE_TEST_TIMEOUT_MS = 60_000;

// Firefox runs only where it is enforced: Playwright's Firefox builds do not
// launch on macOS 27, so locally it is opt-in. CI sets X_FACTORY_E2E_FIREFOX=1
// on Linux, where a Firefox failure fails the build. Chromium and WebKit always run.
const FIREFOX_ENABLED = process.env.X_FACTORY_E2E_FIREFOX === "1";

const ENGINES = [
  { name: "chromium", engine: chromium },
  ...(FIREFOX_ENABLED ? [{ name: "firefox", engine: firefox }] : []),
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

    test(
      "Mod+K and the Search button open the same palette",
      async () => {
        const page = await openPage(browser, "/tickets");
        const palette = page.getByRole("dialog", { name: "Command palette" });
        await page.keyboard.press(`${await modKeyFor(page)}+k`);
        await palette.waitFor();
        await page.keyboard.press("Escape");
        await palette.waitFor({ state: "detached" });

        await page.locator("#btn-search").click();
        await palette.waitFor();
        const focusedRole = await page.evaluate(() =>
          document.activeElement?.getAttribute("role"),
        );
        expect(focusedRole).toBe("combobox");
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "G then T and G then R move between sections",
      async () => {
        const page = await openPage(browser, "/runs");
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press("g");
        await page.keyboard.press("t");
        await page.waitForURL(/\/tickets$/);
        await page.keyboard.press("g");
        await page.keyboard.press("r");
        await page.waitForURL(/\/runs$/);
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "single keys are ignored while a text field has focus",
      async () => {
        const page = await openPage(browser, "/tickets");
        const search = page.locator("#queue-search");
        await search.focus();
        await page.keyboard.type("gr?n");
        expect(new URL(page.url()).pathname).toBe("/tickets");
        expect(await search.inputValue()).toBe("gr?n");
        expect(
          await page
            .getByRole("dialog", { name: "Keyboard shortcuts" })
            .count(),
        ).toBe(0);
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "/ focuses the page search; ? opens the shortcut sheet; Esc closes it",
      async () => {
        const page = await openPage(browser, "/tickets");
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
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "ArrowDown and ArrowUp move focus through the history rows",
      async () => {
        const page = await openPage(browser, "/runs?filter=done");
        await page.waitForSelector("[data-list-row]");
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press("ArrowDown");
        const first = await page.evaluate(() =>
          document.activeElement?.getAttribute("href"),
        );
        await page.keyboard.press("ArrowDown");
        const second = await page.evaluate(() =>
          document.activeElement?.getAttribute("href"),
        );
        expect(second).not.toBe(first);
        await page.keyboard.press("ArrowUp");
        expect(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("href"),
          ),
        ).toBe(first);
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "Return opens the focused history row",
      async () => {
        const page = await openPage(browser, "/runs?filter=done");
        await page.waitForSelector("[data-list-row]");
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press("ArrowDown");
        const href = await page.evaluate(
          () => document.activeElement?.getAttribute("href") ?? "",
        );
        await page.keyboard.press("Enter");
        await page.waitForURL((url) => url.pathname === href);
      },
      PAGE_TEST_TIMEOUT_MS,
    );

    test(
      "Mod+Enter presses the primary action on the run page",
      async () => {
        const run = instance.runs.find((r) => r.status === "awaiting_review");
        if (!run) throw new Error("The demo data has no run awaiting review.");
        const page = await openPage(browser, `/runs/${run.id}`);
        // The seeded run is shared by every engine, so the approve request is
        // aborted rather than sent: the press is what this test checks.
        await page.route(
          (url) => url.pathname.includes(`/api/runs/${run.id}`),
          (route) => {
            if (route.request().method() === "GET") return route.continue();
            return route.abort();
          },
        );
        await page.locator("[data-primary-action]").waitFor();
        const approved = page.waitForRequest(
          (req) =>
            req.method() === "POST" &&
            req.url().includes(`/api/runs/${run.id}`),
        );
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press(`${await modKeyFor(page)}+Enter`);
        await approved;
      },
      PAGE_TEST_TIMEOUT_MS,
    );
  });
}
