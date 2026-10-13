// test/responsive-browser.test.ts — A 290px floor for every screen.
//
// happy-dom applies no stylesheet, so a layout bug only shows in a real browser.
// This test drives Chromium through every route at 290/320/360/390px with a
// touch pointer and holds the rendered geometry against the phone contract:
// the document never scrolls sideways; in every `.ui-list-row` the title and
// its trailing accessory never intersect, and the title keeps at least 60% of
// the row's width or sits on its own line; no visible text box runs past the
// viewport (a box inside its own horizontal scroller — a code block, a wide
// table — is allowed to scroll inside that box); and the run page's stepper
// labels never collide. It failed on the Runs list at 290px before the fixes
// (the row was a single flex line, so the badge and time squeezed the title
// to ~80px) and passes now.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright-core";
import { startIsolatedInstance } from "../scripts/screenshots/instance.js";

const WIDTHS = [290, 320, 360, 390] as const;

/** Every route the phone contract holds, per width. */
function routesFor(instance: {
  runId: string;
  projectId: string;
}): Array<{ name: string; path: string; wait: string }> {
  return [
    { name: "runs (All)", path: "/runs?filter=all", wait: "#area-runs" },
    {
      name: "run detail",
      path: `/runs/${instance.runId}`,
      wait: ".workflow-stepper",
    },
    { name: "projects", path: "/projects", wait: "#area-projects" },
    {
      name: "project detail",
      path: `/projects/${instance.projectId}`,
      wait: "#project-tracker-section",
    },
    ...["general", "trackers", "models", "git", "diagnostics", "help"].map(
      (tab) => ({
        name: `settings (${tab})`,
        path: `/settings?tab=${tab}`,
        wait: "#area-settings",
      }),
    ),
    { name: "welcome", path: "/welcome", wait: "#area-welcome" },
    { name: "docs", path: "/docs", wait: "#area-docs" },
    { name: "not-found", path: "/no-such-page", wait: "#app-shell" },
  ];
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

/**
 * The in-page audit: every layout rule the phone contract states, evaluated on
 * the real rendered geometry. Returns one string per violation.
 */
async function auditPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const violations: string[] = [];
    const vw = window.innerWidth;
    const doc = document.documentElement;

    if (doc.scrollWidth > vw + 1) {
      violations.push(
        `document scrolls horizontally: scrollWidth ${doc.scrollWidth} > viewport ${vw}`,
      );
    }

    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let node: Element | null = el;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        node = node.parentElement;
      }
      return true;
    };

    /** An ancestor that scrolls horizontally on its own box may hold overflow. */
    const inOwnScroller = (el: Element): boolean => {
      for (
        let node = el.parentElement;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const overflowX = getComputedStyle(node).overflowX;
        if (
          (overflowX === "auto" || overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        ) {
          return true;
        }
      }
      return false;
    };

    const describe = (el: Element): string => {
      const cls = typeof el.className === "string" ? el.className : "";
      return `${el.tagName.toLowerCase()}${cls ? `.${cls.split(" ").join(".")}` : ""}`;
    };

    // 1. No visible text box extends past the viewport (its own scroller aside).
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!visible(el)) continue;
      if (el.closest("[aria-hidden='true']")) continue;
      const hasOwnText = Array.from(el.childNodes).some(
        (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
      );
      if (!hasOwnText) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 1 || rect.left < -1) {
        if (inOwnScroller(el)) continue;
        violations.push(
          `text past the viewport: <${describe(el)}> left ${Math.round(rect.left)}, right ${Math.round(rect.right)} (viewport ${vw}): "${(el.textContent ?? "").trim().slice(0, 40)}"`,
        );
      }
    }

    // 2. Every list row: title and trailing never intersect, and the title
    //    keeps ≥60% of the row's width or sits on its own line.
    for (const row of document.querySelectorAll<HTMLElement>(".ui-list-row")) {
      if (!visible(row)) continue;
      const main = row.querySelector<HTMLElement>(":scope > .ui-list-row-main");
      const trailing = row.querySelector<HTMLElement>(
        ":scope > .ui-list-row-trailing",
      );
      if (!main || !trailing || !visible(main) || !visible(trailing)) continue;
      const rowRect = row.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const trailingRect = trailing.getBoundingClientRect();
      const text = (row.textContent ?? "").trim().slice(0, 50);
      const intersects =
        mainRect.left < trailingRect.right - 1 &&
        trailingRect.left < mainRect.right - 1 &&
        mainRect.top < trailingRect.bottom - 1 &&
        trailingRect.top < mainRect.bottom - 1;
      if (intersects) {
        violations.push(
          `row title and trailing intersect: "${text}" (main ${Math.round(mainRect.left)}–${Math.round(mainRect.right)}, trailing ${Math.round(trailingRect.left)}–${Math.round(trailingRect.right)})`,
        );
        continue;
      }
      const ownLine = trailingRect.top >= mainRect.bottom - 1;
      if (!(mainRect.width >= rowRect.width * 0.6 - 2 || ownLine)) {
        violations.push(
          `row title squeezed: ${Math.round(mainRect.width)}px of ${Math.round(rowRect.width)}px row: "${text}"`,
        );
      }
    }

    // 3. The stepper's visible labels never collide.
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(".step-label"),
    ).filter(visible);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i] as HTMLElement;
        const b = labels[j] as HTMLElement;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (
          ar.left < br.right - 1 &&
          br.left < ar.right - 1 &&
          ar.top < br.bottom - 1 &&
          br.top < ar.bottom - 1
        ) {
          violations.push(
            `stepper labels intersect: "${a.textContent}" / "${b.textContent}"`,
          );
        }
      }
    }

    return violations;
  });
}

describe("a 290px floor: every route holds the phone contract", () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow, squeezed rows or collisions at ${width}px`, async () => {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const failures: string[] = [];
      try {
        for (const route of routesFor(instance)) {
          await page.goto(`${instance.url}${route.path}`, {
            waitUntil: "load",
          });
          await page.waitForSelector("#app-shell");
          await page.waitForSelector(route.wait, { timeout: 15_000 });
          // Let the seeded queries resolve and any entry animation settle.
          await page.waitForTimeout(400);
          const violations = await auditPage(page);
          for (const violation of violations) {
            failures.push(
              `${route.name} (${route.path}) @${width}px: ${violation}`,
            );
          }
        }
      } finally {
        await context.close();
      }
      expect(failures).toEqual([]);
    }, 180_000);
  }
});
