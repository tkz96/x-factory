// test/assistant-sheet-layout.test.ts — The add-project assistant's sheet is as
// tall as the step it shows (#268, "the sheet fits its content").
//
// Two opposite failures are only measurable in a real browser: a sheet that
// fills the window on a short step wastes the screen and detaches its own
// actions from the fields, and one that grows past the window hides the action
// bar behind the edge. This drives the real app at desktop and phone width and
// measures the sheet against its own content and against the window.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const TIMEOUT = 240_000;

const VIEWPORTS = [
  { name: "desktop 1440", width: 1440, height: 900 },
  { name: "phone 390", width: 390, height: 844 },
] as const;

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

interface SheetMetrics {
  /** The dialog's own height: what the user sees. */
  height: number;
  /** The dialog's content box — its height without padding or border. */
  contentBox: number;
  /** Head + counter + body + action bar: everything the sheet has to show. */
  content: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  viewportHeight: number;
  viewportWidth: number;
  /** The part of the sheet that scrolls, when its content does not fit. */
  scroll: { scrollHeight: number; clientHeight: number } | null;
}

async function sheetMetrics(page: Page): Promise<SheetMetrics> {
  return page.evaluate(() => {
    const dialog = document.getElementById(
      "onboarding-wizard-modal",
    ) as HTMLElement;
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    const vertical =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    const content = Array.from(dialog.children).reduce(
      (total, child) => total + child.getBoundingClientRect().height,
      0,
    );
    const scroller = Array.from(dialog.querySelectorAll<HTMLElement>("*")).find(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    return {
      height: rect.height,
      contentBox: rect.height - vertical,
      content,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      scroll: scroller
        ? {
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          }
        : null,
    };
  });
}

/** Opens the assistant the way a user does, from the Projects screen. */
async function openAssistant(page: Page): Promise<void> {
  // Either wording opens it; the Projects screen owns which one it shows.
  await page
    .getByRole("button", { name: /Onboard Project|Add Project/ })
    .first()
    .click();
  await page.locator("#onboarding-wizard-modal").waitFor();
}

for (const viewport of VIEWPORTS) {
  describe(`the assistant sheet at ${viewport.name}`, () => {
    test(
      "fits the step it shows, and stays inside the window",
      async () => {
        const page = await browser.newPage({ viewport });
        await page.goto(`${instance.url}/projects`, { waitUntil: "load" });
        await openAssistant(page);

        // Step 1 — a short step: the sheet is exactly as tall as what it shows,
        // so a short step never leaves empty space behind it.
        const first = await sheetMetrics(page);
        expect(Math.abs(first.contentBox - first.content)).toBeLessThanOrEqual(
          2,
        );
        expect(first.height).toBeLessThan(first.viewportHeight);
        expect(
          Math.abs((first.left + first.right) / 2 - first.viewportWidth / 2),
        ).toBeLessThanOrEqual(2);
        expect(first.left).toBeGreaterThanOrEqual(0);
        expect(first.right).toBeLessThanOrEqual(first.viewportWidth);

        // The step's own action bar is on screen: a user can always continue.
        const next = page.getByRole("button", { name: "Continue" });
        expect(await next.isVisible()).toBe(true);
        const nextBox = await next.boundingBox();
        expect(nextBox?.y ?? 0).toBeGreaterThanOrEqual(first.top);
        expect((nextBox?.y ?? 0) + (nextBox?.height ?? 0)).toBeLessThanOrEqual(
          first.bottom,
        );

        // Step 2 — a taller step, the same rule: the sheet never grows past the
        // window, and what does not fit scrolls inside it.
        await page
          .getByLabel("Repository URL")
          .fill("https://github.com/acme/rocket");
        await page.getByLabel("Project Name").fill("Rocket");
        await next.click();
        await page.locator("#onboard-step-2").waitFor();
        // The cards are the tall part: measure the step at its full height, not
        // its loading region.
        await page.locator("#select-tracker-provider").waitFor();

        const second = await sheetMetrics(page);
        expect(
          Math.abs(second.contentBox - second.content),
        ).toBeLessThanOrEqual(2);
        expect(second.bottom).toBeLessThanOrEqual(second.viewportHeight + 1);
        expect(second.height).toBeGreaterThanOrEqual(first.height);
        if (second.scroll !== null) {
          // Capped by the window rather than by the content: that is the step
          // that scrolls, not the sheet.
          expect(second.height).toBeLessThanOrEqual(second.viewportHeight);
        }

        await page.close();
      },
      TIMEOUT,
    );
  });
}
