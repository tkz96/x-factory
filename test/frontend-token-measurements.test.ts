// test/frontend-token-measurements.test.ts — Measurements and colours the
// review found hard-coded now come from tokens.css (#241 review, item 1).

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const tokens = readFileSync("src/frontend/styles/tokens.css", "utf8");
const controlsCss = readFileSync(
  "src/frontend/styles/shared/controls.css",
  "utf8",
);

describe("hard-coded values are tokens", () => {
  it("the diagram minimap mask uses the scrim token, not a literal rgba", () => {
    const tsx = readFileSync(
      "src/frontend/components/diagrams/DiagramModal.tsx",
      "utf8",
    );
    // The minimap forwards maskColor into a CSS custom property, so a var()
    // string resolves exactly like the rgba() it replaces.
    expect(tsx).toContain('maskColor="var(--scrim)"');
    expect(tsx).not.toMatch(/rgba\(/);
    expect(tokens).toMatch(/--scrim:\s*rgba\(0, 0, 0, 0\.4\);/);
  });

  it("the settings panes space their rows from tokens", () => {
    // The sandbox switch is a Settings row now (S-01): its offset is the
    // settings group's, so the pane itself holds no `.setting-switch` and no
    // literal spacing.
    const css = readFileSync("src/frontend/views/SettingsView.css", "utf8");
    expect(css).not.toContain(".setting-switch");
    expect(css).toMatch(
      /\.settings-pane-subtitle\s*\{[^}]*margin:\s*var\(--space-/,
    );
    expect(css).not.toMatch(/\.settings-pane-subtitle\s*\{[^}]*margin:\s*\d/);
  });

  it("the repository settings inputs reuse the shared form-input focus ring", () => {
    const tsx = readFileSync(
      "src/frontend/components/projects/RepositorySettings.tsx",
      "utf8",
    );
    const css = readFileSync(
      "src/frontend/components/projects/RepositorySettings.css",
      "utf8",
    );
    expect(tsx).toContain('className="form-input repo-settings-input"');
    expect(tsx).toContain(
      'className="form-input repo-settings-input repo-settings-input--mono"',
    );
    // The focus ring lives in styles/shared/forms.css only.
    expect(css).not.toContain("box-shadow");
    expect(css).not.toContain(":focus-visible");
  });
});

// ─── Type scale and control metrics (spec #292) ───────────────────────────
// The tokens are rem, so the test reads them in a real browser and converts
// them to px at the default 16px root size, the way a screen renders them. The
// pointers are set when the browser launches: Blink's primaryPointerType and
// availablePointerTypes settings (2 = coarse, 4 = fine). CDP media emulation
// does not change pointer or any-pointer.

const MEASURE_TIMEOUT = 120_000;

const MACOS_SCALE = {
  "--text-large-title": 26,
  "--text-title-1": 22,
  "--text-title-2": 17,
  "--text-title-3": 15,
  "--text-headline": 13,
  "--text-body": 13,
  "--text-callout": 12,
  "--text-subhead": 11,
  "--text-footnote": 10,
  "--text-caption-1": 10,
  "--text-caption-2": 10,
} as const;

const IOS_SCALE = {
  "--text-large-title": 34,
  "--text-title-1": 28,
  "--text-title-2": 22,
  "--text-title-3": 20,
  "--text-headline": 17,
  "--text-body": 17,
  "--text-callout": 16,
  "--text-subhead": 15,
  "--text-footnote": 13,
  "--text-caption-1": 12,
  "--text-caption-2": 11,
} as const;

const MACOS_METRICS = {
  "--control-height": 28,
  "--control-height-sm": 22,
  "--control-height-lg": 32,
  "--header-height": 52,
  "--sidebar-row-height": 28,
} as const;

interface MediaCondition {
  name: string;
  width: number;
  /** Blink's primaryPointerType: 2 is coarse (touch), 4 is fine (mouse). */
  primaryPointer: 2 | 4;
  /** Blink's availablePointerTypes bit mask, the same values (2 coarse, 4 fine). */
  availablePointers: number;
  scale: "macos" | "ios";
  tapMin: number;
  /** The computed height of a regular and a small .ui-button (spec #292). */
  buttonHeights: { regular: number; small: number };
}

/** The four conditions the spec names (#292 "Type scale and density"). */
const MEDIA_CONDITIONS: MediaCondition[] = [
  {
    name: "fine pointer, wide viewport",
    width: 1280,
    primaryPointer: 4,
    availablePointers: 4,
    scale: "macos",
    tapMin: 24,
    buttonHeights: { regular: 28, small: 22 },
  },
  {
    name: "coarse pointer",
    width: 1280,
    primaryPointer: 2,
    availablePointers: 2,
    scale: "ios",
    tapMin: 44,
    buttonHeights: { regular: 44, small: 44 },
  },
  {
    name: "fine primary pointer with a coarse secondary pointer",
    width: 1280,
    primaryPointer: 4,
    availablePointers: 6,
    scale: "macos",
    tapMin: 44,
    buttonHeights: { regular: 44, small: 44 },
  },
  {
    name: "fine pointer, narrow viewport",
    width: 390,
    primaryPointer: 4,
    availablePointers: 4,
    scale: "ios",
    tapMin: 44,
    buttonHeights: { regular: 44, small: 44 },
  },
];

/** Reads the custom properties in the browser and returns their px values. */
async function measureTokens(
  page: import("playwright-core").Page,
  names: readonly string[],
): Promise<Record<string, number>> {
  const raw = await page.evaluate(
    (list) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        list.map((name) => [name, style.getPropertyValue(name).trim()]),
      );
    },
    [...names],
  );
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    const amount = Number.parseFloat(value);
    out[name] = value.endsWith("rem") ? amount * 16 : amount;
  }
  return out;
}

describe("type scale and control metrics by media condition (spec #292)", () => {
  // The tokens live in tokens.css. Loading that file alone keeps the test
  // independent of the app's build and its server.
  const tokenCss = tokens;

  for (const condition of MEDIA_CONDITIONS) {
    it(
      `${condition.scale === "macos" ? "macOS" : "iOS"} scale and tap target under ${condition.name}`,
      async () => {
        const { chromium } = await import("playwright-core");
        const args = [
          `--blink-settings=primaryPointerType=${condition.primaryPointer},availablePointerTypes=${condition.availablePointers}`,
        ];
        let browser: import("playwright-core").Browser;
        try {
          browser = await chromium.launch({ args });
        } catch {
          browser = await chromium.launch({ channel: "chrome", args });
        }
        try {
          const context = await browser.newContext({
            viewport: { width: condition.width, height: 800 },
          });
          const page = await context.newPage();
          await page.setContent(
            `<!doctype html><html><head><style>${tokenCss}</style><style>${controlsCss}</style></head><body>` +
              `<button class="ui-button ui-button--primary" id="regular">Go</button>` +
              `<button class="ui-button ui-button--sm" id="small">Add</button>` +
              `</body></html>`,
          );
          const heights = await page.evaluate(() => ({
            regular:
              document.getElementById("regular")?.getBoundingClientRect()
                .height ?? -1,
            small:
              document.getElementById("small")?.getBoundingClientRect()
                .height ?? -1,
          }));
          expect(heights).toEqual(condition.buttonHeights);

          const scale = condition.scale === "macos" ? MACOS_SCALE : IOS_SCALE;
          const sizes = await measureTokens(page, Object.keys(scale));
          expect(sizes).toEqual(scale);

          const metrics = await measureTokens(page, [
            "--tap-min",
            ...(condition.scale === "macos"
              ? Object.keys(MACOS_METRICS)
              : ["--header-height"]),
          ]);
          expect(metrics["--tap-min"]).toBe(condition.tapMin);
          if (condition.scale === "macos") {
            expect(metrics).toMatchObject(MACOS_METRICS);
          } else {
            expect(metrics["--header-height"]).toBe(56);
          }
          await context.close();
        } finally {
          await browser.close();
        }
      },
      MEASURE_TIMEOUT,
    );
  }
});

describe("Increase Contrast restores strong lines in every appearance (spec #292)", () => {
  it(
    "--separator and --hairline take the strong border under dark appearance with data-contrast=more",
    async () => {
      const { chromium } = await import("playwright-core");
      let browser: import("playwright-core").Browser;
      try {
        browser = await chromium.launch();
      } catch {
        browser = await chromium.launch({ channel: "chrome" });
      }
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
        await page.setContent(
          `<!doctype html><html data-contrast="more"><head><style>${tokens}</style></head><body></body></html>`,
        );
        const values = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return {
            separator: style.getPropertyValue("--separator").trim(),
            border: style.getPropertyValue("--border").trim(),
            hairline: style.getPropertyValue("--hairline").trim(),
          };
        });
        expect(values.separator).toBe(values.border);
        expect(values.hairline).toBe("1px");
        await context.close();
      } finally {
        await browser.close();
      }
    },
    MEASURE_TIMEOUT,
  );
});
