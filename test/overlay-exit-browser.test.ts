// test/overlay-exit-browser.test.ts — Overlays animate when they close (#250).
//
// The exit is a browser fact. happy-dom applies no stylesheet, so nothing ever plays
// there and a closed overlay leaves in the same tick; Chromium plays the real CSS. This
// test opens the app's own dialog (the command palette), watches the close from inside
// the page, and holds the result against the motion tokens: the overlay is still in the
// DOM, marked `data-exiting`, while its exit runs, it is gone once the animation ends,
// leaving takes less time than arriving (#252), and under reduced motion it collapses to
// the short crossfade without moving.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** What the in-page watcher records about one overlay, opening and closing. */
interface OverlayRecord {
  /** When the overlay first carried `data-entering`. */
  enteringAt: number | null;
  /** When `data-entering` was gone: the entry animation had ended. */
  enteredAt: number | null;
  /** When the overlay first carried `data-exiting`, still in the DOM. */
  exitingAt: number | null;
  /** When the dialog had left the DOM. */
  removedAt: number | null;
  /** The surface's computed animation-duration during the entry. */
  enteringDuration: string | null;
  /** The surface's computed animation-duration as the exit began. */
  exitingDuration: string | null;
  /** The surface's computed transform as the exit began. */
  transform: string | null;
}

declare global {
  interface Window {
    __xfExit?: OverlayRecord;
  }
}

let instance: Awaited<ReturnType<typeof startIsolatedInstance>>;
let browser: Browser;

beforeAll(async () => {
  instance = await startIsolatedInstance();
  browser = await chromium.launch();
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await instance?.stop();
});

async function openQueue(
  options: { reducedMotion?: "reduce" } = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context: BrowserContext = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${instance.url}/queue`, { waitUntil: "load" });
  await page.waitForSelector("#app-shell");
  return { page, close: () => context.close() };
}

function readRecord(page: Page): Promise<OverlayRecord> {
  return page.evaluate(() => window.__xfExit as OverlayRecord);
}

/** Milliseconds from a computed CSS time, so tokens and styles compare directly. */
function cssTime(value: string | null): number {
  if (!value) return 0;
  const amount = Number.parseFloat(value);
  return value.trim().endsWith("ms") ? amount : amount * 1000;
}

/** Reads a motion token off the page's root element. */
function readToken(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (token) =>
      getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  );
}

/** The window the overlay was actually in, from the exit mark to its removal. */
function exitWindow(record: OverlayRecord): number {
  return (record.removedAt ?? 0) - (record.exitingAt ?? 0);
}

/** The window the entry animation ran in. */
function enterWindow(record: OverlayRecord): number {
  return (record.enteredAt ?? 0) - (record.enteringAt ?? 0);
}

/**
 * Watches one overlay from inside the page: attribute changes give the exact frames the
 * entering and exiting states appear and disappear, so no Playwright round trip has to
 * win a race against a 90ms animation.
 */
function watchOverlayExit() {
  const overlay = () => document.querySelector(".xf-dialog-overlay");
  const dialog = () => document.querySelector('[role="dialog"]');
  const surfaceDuration = () => {
    const surface = document.querySelector(".xf-dialog-content");
    return surface ? getComputedStyle(surface).animationDuration : null;
  };
  const record: OverlayRecord = {
    enteringAt: null,
    enteredAt: null,
    exitingAt: null,
    removedAt: null,
    enteringDuration: null,
    exitingDuration: null,
    transform: null,
  };
  window.__xfExit = record;
  const sample = () => {
    const element = overlay();
    const entering = element?.hasAttribute("data-entering") ?? false;
    if (record.enteringAt === null && entering) {
      record.enteringAt = performance.now();
      record.enteringDuration = surfaceDuration();
    }
    if (record.enteringAt !== null && record.enteredAt === null && !entering) {
      record.enteredAt = performance.now();
    }
    if (record.exitingAt === null && element?.hasAttribute("data-exiting")) {
      record.exitingAt = performance.now();
      record.exitingDuration = surfaceDuration();
      const surface = document.querySelector(".xf-dialog-content");
      if (surface) record.transform = getComputedStyle(surface).transform;
    }
    if (record.exitingAt !== null && record.removedAt === null && !dialog()) {
      record.removedAt = performance.now();
    }
  };
  new MutationObserver(sample).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  sample();
}

/** Opens the command palette with the watcher in place, and waits for its entry to end. */
async function openPalette(page: Page) {
  await page.evaluate(watchOverlayExit);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press(`${MOD}+k`);
  await palette.waitFor();
  // The exit is measured on its own, so the entry animation must be over first.
  await page.waitForFunction(
    () => !document.querySelector(".xf-dialog-overlay[data-entering]"),
  );
  return palette;
}

describe("closing an overlay animates in chromium (#250)", () => {
  test("the palette stays in the DOM, marked data-exiting, until its exit has ended", async () => {
    const { page, close } = await openQueue();
    const palette = await openPalette(page);

    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
    const record = await readRecord(page);

    // The exit was watched in the page: the overlay carried `data-exiting` while the
    // dialog was still mounted, and the dialog was gone once the animation ended.
    expect(record.exitingAt).not.toBeNull();
    expect(record.removedAt).not.toBeNull();
    expect(exitWindow(record)).toBeGreaterThan(0);
    // The surface settles as it leaves, rather than being cut off mid-animation.
    expect(record.transform).not.toBe("none");
    // Both beats come from the motion ladder, and leaving is the quicker one.
    expect(cssTime(record.exitingDuration)).toBe(
      cssTime(await readToken(page, "--duration-instant")),
    );
    expect(cssTime(record.enteringDuration)).toBe(
      cssTime(await readToken(page, "--duration-fast")),
    );
    expect(exitWindow(record)).toBeLessThan(enterWindow(record));
    await close();
  }, 60_000);

  test("with reduced motion the palette closes within the short crossfade", async () => {
    const { page, close } = await openQueue({ reducedMotion: "reduce" });
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const palette = await openPalette(page);
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
    const record = await readRecord(page);

    expect(record.exitingAt).not.toBeNull();
    expect(record.removedAt).not.toBeNull();
    // One short crossfade: the ladder has collapsed to a single beat, the surface never
    // moves, and the overlay is gone within that beat.
    expect(cssTime(record.exitingDuration)).toBe(
      cssTime(await readToken(page, "--duration-instant")),
    );
    expect(cssTime(record.exitingDuration)).toBe(
      cssTime(record.enteringDuration),
    );
    expect(record.transform).toBe("none");
    expect(exitWindow(record)).toBeLessThan(250);
    await close();
  }, 60_000);
});
