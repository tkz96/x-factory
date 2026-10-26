// test/frontend-polish.test.ts — the polish pass on #292 (issue #309).
// Static: every h2–h4 in src/frontend names its text style or sits in a block, and
// the settings pane titles share one style. Emulated: in Chromium with forced
// colours on, the primary button stays distinguishable from the secondary one.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dir, "..");
const FRONTEND = path.join(ROOT, "src/frontend");
const STYLES = path.join(FRONTEND, "styles");
const BROWSER_TIMEOUT = 120_000;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** The opening tag of every h2–h4 in a source file, attributes included. */
function headingTags(text: string): string[] {
  return [...text.matchAll(/<h([234])\b([^>]*)>/g)].map((m) => m[0]);
}

describe("headings use one documented style (spec #292, item 5)", () => {
  it("every h2, h3 and h4 under src/frontend names a text style or is a block", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(FRONTEND)) {
      const rel = path.relative(ROOT, file);
      // The blocks in components/ui carry their heading style in controls.css.
      if (rel.startsWith(path.join("src", "frontend", "components", "ui"))) {
        continue;
      }
      const text = fs.readFileSync(file, "utf8");
      for (const tag of headingTags(text)) {
        if (/className=\{/.test(tag)) continue; // a heading that takes its style from a prop or a map
        if (/className="[^"]*\btext-[a-z0-9-]+/.test(tag)) continue;
        missing.push(`${rel}: ${tag}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the markdown heading map names a text style at every level", () => {
    const text = fs.readFileSync(
      path.join(FRONTEND, "components/MarkdownViewer.tsx"),
      "utf8",
    );
    const levels = [...text.matchAll(/^\s+\d: "([^"]*)",$/gm)].map((m) => m[1]);
    expect(levels.length).toBeGreaterThanOrEqual(12);
    for (const level of levels) {
      expect(level).toMatch(/\btext-[a-z0-9-]+/);
    }
  });

  it("sibling settings pane titles share one style: Title 3", () => {
    const text = fs.readFileSync(
      path.join(FRONTEND, "views/SettingsView.tsx"),
      "utf8",
    );
    const titles = [
      ...text.matchAll(/<h2 className="settings-pane-title([^"]*)"/g),
    ];
    expect(titles.length).toBeGreaterThanOrEqual(5);
    for (const title of titles) {
      expect(title[1]).toBe(" text-title-3");
    }
  });
});

describe("the page subtitle and small controls keep their sizes (spec #292, item 4)", () => {
  it("no small control takes the Caption style", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(FRONTEND)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/<Button\b[^>]*>/g)) {
        if (/text-caption-/.test(m[0]))
          offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("forced colours: the primary action stays distinct (spec #292, item 1)", () => {
  const forced = fs
    .readFileSync(path.join(STYLES, "forced-colors.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("a primary button takes the system selection pair in forced colours", () => {
    const rule = forced.match(
      /:root \.ui-button--primary,\s*:root \.ui-button--primary\[data-hovered\]\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/background:\s*Highlight/);
    expect(rule?.[1]).toMatch(/color:\s*HighlightText/);
  });

  it("the primary rule comes after the shared button rule it overrides", () => {
    const shared = forced.indexOf(":root .ui-button,");
    const primary = forced.indexOf(":root .ui-button--primary,");
    expect(shared).toBeGreaterThan(-1);
    expect(primary).toBeGreaterThan(shared);
  });
});

describe("forced colours, emulated: the primary button in a browser (spec #292, item 1)", () => {
  it(
    "a primary and a secondary button compute different faces under forced colours",
    async () => {
      let browser: import("playwright-core").Browser;
      try {
        browser = await chromium.launch();
      } catch {
        browser = await chromium.launch({ channel: "chrome" });
      }
      try {
        const page = await (await browser.newContext()).newPage();
        await page.emulateMedia({ forcedColors: "active" });
        const css = [
          "tokens.css",
          "shared/controls.css",
          "forced-colors.css",
        ].map((file) => fs.readFileSync(path.join(STYLES, file), "utf8"));
        await page.setContent(
          `<!doctype html><html><head><style>${css.join("\n")}</style></head><body>` +
            `<button class="ui-button ui-button--primary" id="primary">Approve Plan</button>` +
            `<button class="ui-button ui-button--secondary" id="secondary">Request Changes</button>` +
            `</body></html>`,
        );
        const styles = await page.evaluate(() => {
          const read = (id: string) => {
            const style = getComputedStyle(
              document.getElementById(id) as Element,
            );
            return {
              background: style.backgroundColor,
              color: style.color,
              border: style.borderTopColor,
            };
          };
          return { primary: read("primary"), secondary: read("secondary") };
        });
        expect(styles.primary.background).not.toBe(styles.secondary.background);
        // The label reads against its own face, not the page's.
        expect(styles.primary.color).not.toBe(styles.primary.background);
      } finally {
        await browser.close();
      }
    },
    BROWSER_TIMEOUT,
  );
});
