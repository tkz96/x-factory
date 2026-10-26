// test/accessibility-settings-browser.test.ts — Reduce Transparency and Readable font
// in Chromium (spec #292). One test emulates prefers-reduced-transparency through
// CDP and expects Automatic to give opaque chrome. Another sets On without any
// emulation and expects opaque chrome too. A third turns the Readable font on and
// checks that its faces are requested only then, and that both settings persist.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const TIMEOUT = 240_000;
const READABLE_FONT = /\/fonts\/AtkinsonHyperlegible(Next|Mono)-/;

interface ChromeState {
  transparency: string | undefined;
  backdropFilter: string;
  background: string;
}

async function chromeState(page: Page): Promise<ChromeState> {
  return page.evaluate(() => {
    const toolbar = document.querySelector(".toolbar");
    if (!(toolbar instanceof HTMLElement)) throw new Error("no toolbar");
    const style = getComputedStyle(toolbar);
    return {
      transparency: document.documentElement.dataset.transparency,
      backdropFilter: style.backdropFilter,
      background: style.backgroundColor,
    };
  });
}

/** Opaque chrome: no backdrop blur and a solid background colour (no alpha). */
function isOpaque(state: ChromeState): boolean {
  return (
    state.backdropFilter === "none" && !state.background.startsWith("rgba(")
  );
}

/** Polls until the toolbar matches. The background transitions for 300ms. */
async function waitForChrome(
  page: Page,
  opaque: boolean,
): Promise<ChromeState> {
  let state = await chromeState(page);
  for (let i = 0; i < 60 && isOpaque(state) !== opaque; i++) {
    await page.waitForTimeout(50);
    state = await chromeState(page);
  }
  return state;
}

async function chooseTransparency(page: Page, label: string): Promise<void> {
  await page
    .locator(".ui-segment", {
      has: page.getByRole("radio", { name: `Reduce transparency: ${label}` }),
    })
    .click();
}

describe("Reduce Transparency and Readable font in Chromium (spec #292)", () => {
  let instance: Awaited<ReturnType<typeof startIsolatedInstance>>;
  let browser: Browser;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    instance = await startIsolatedInstance();
    try {
      browser = await chromium.launch();
    } catch {
      browser = await chromium.launch({ channel: "chrome" });
    }
  }, TIMEOUT);

  afterAll(async () => {
    for (const context of contexts) await context.close();
    await browser?.close();
    await instance?.stop();
  });

  async function openAccessibility(page: Page): Promise<void> {
    await page.goto(`${instance.url}/settings?tab=accessibility`, {
      waitUntil: "load",
    });
    await page
      .getByRole("radio", { name: "Reduce transparency: On" })
      .waitFor();
    await page.waitForLoadState("networkidle");
  }

  test(
    "Automatic follows an emulated prefers-reduced-transparency: reduce and keeps the toolbar opaque",
    async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
      });

      await openAccessibility(page);
      const state = await waitForChrome(page, true);
      expect(state.transparency).toBe("reduced");
      expect(isOpaque(state)).toBe(true);
    },
    TIMEOUT,
  );

  test(
    "On makes the toolbar opaque without emulation, and Off restores glass",
    async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();

      await openAccessibility(page);
      expect((await chromeState(page)).transparency).toBe("full");

      await chooseTransparency(page, "On");
      await page.waitForFunction(
        () => document.documentElement.dataset.transparency === "reduced",
      );
      expect(isOpaque(await waitForChrome(page, true))).toBe(true);

      await chooseTransparency(page, "Off");
      await page.waitForFunction(
        () => document.documentElement.dataset.transparency === "full",
      );
      expect(isOpaque(await waitForChrome(page, false))).toBe(false);
    },
    TIMEOUT,
  );

  test(
    "the On setting and the Readable font persist across a reload, and the Atkinson faces load only when the font is on",
    async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const fontRequests: string[] = [];
      page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (READABLE_FONT.test(pathname)) fontRequests.push(pathname);
      });

      await openAccessibility(page);
      expect(fontRequests).toEqual([]);

      await chooseTransparency(page, "On");
      await page
        .locator(".ui-switch", {
          has: page.getByRole("switch", { name: "Readable font" }),
        })
        .click();
      await page.waitForFunction(
        () => document.documentElement.dataset.font === "readable",
      );
      await page.waitForLoadState("networkidle");
      expect(fontRequests.length).toBeGreaterThan(0);

      await page.reload({ waitUntil: "load" });
      await page
        .getByRole("radio", { name: "Reduce transparency: On" })
        .waitFor();
      await page.waitForLoadState("networkidle");
      expect(
        await page.evaluate(() => document.documentElement.dataset.font),
      ).toBe("readable");
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.transparency,
        ),
      ).toBe("reduced");
      expect(
        await page
          .getByRole("radio", { name: "Reduce transparency: On" })
          .isChecked(),
      ).toBe(true);
    },
    TIMEOUT,
  );
});
