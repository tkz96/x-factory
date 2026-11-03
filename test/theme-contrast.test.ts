// test/theme-contrast.test.ts — Contrast verification across theme × appearance × contrast (#248, #249).
// Requires 4.5:1 for body/muted text, and 3:1 for controls and focus rings.
// The twelve sets (Default, Graphite, Sandstone × Light, Dark × Standard, More)
// are resolved the way the browser cascades tokens.css: matching rules in
// specificity and source order, with var() references followed.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  composite,
  contrastRatio,
  parseColor,
  type RGB,
} from "./helpers/contrast.js";

// ─── A small cascade over tokens.css ────────────────────────────────────────

type Combo = Record<string, string>;

interface Rule {
  /** Attribute conditions of one selector, e.g. [["data-theme","graphite"]]. */
  conditions: [string, string][];
  order: number;
  declarations: [string, string][];
}

/** Top-level style rules only: @font-face and @media blocks are skipped. */
function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let order = 0;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const selectorText = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (selectorText.startsWith("@")) continue;

    const declarations: [string, string][] = [];
    for (const decl of body.split(";")) {
      const colon = decl.indexOf(":");
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim();
      const value = decl
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, " ");
      if (prop.startsWith("--") && value) declarations.push([prop, value]);
    }

    for (const selector of selectorText.split(",")) {
      let rest = selector.trim();
      const conditions: [string, string][] = [];
      let supported = true;
      while (rest.length > 0) {
        const attr = rest.match(/^\[(data-[a-z-]+)="([^"]+)"\]/);
        if (attr) {
          conditions.push([attr[1] ?? "", attr[2] ?? ""]);
          rest = rest.slice(attr[0].length);
        } else if (rest.startsWith(":root")) {
          rest = rest.slice(":root".length);
        } else {
          supported = false;
          break;
        }
      }
      if (supported) rules.push({ conditions, order: order++, declarations });
    }
  }
  return rules;
}

/** The custom-property values an element computes for one combination. */
function cascade(rules: Rule[], combo: Combo): Record<string, string> {
  const matching = rules
    .filter((rule) =>
      rule.conditions.every(([attr, value]) => combo[attr] === value),
    )
    .sort(
      (a, b) => a.conditions.length - b.conditions.length || a.order - b.order,
    );
  const values: Record<string, string> = {};
  for (const rule of matching) {
    for (const [prop, value] of rule.declarations) values[prop] = value;
  }
  return values;
}

function resolveVars(
  value: string,
  values: Record<string, string>,
  depth = 0,
): string {
  if (depth > 10) return value;
  return value.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g, (_, name: string) =>
    resolveVars(values[name] ?? "", values, depth + 1),
  );
}

interface ResolvedThemeTokens {
  bg: RGB;
  bgCard: RGB;
  text: RGB;
  textMuted: RGB;
  border: RGB;
  /** Control borders (inputs, secondary buttons, segments): --border-control. */
  controlBorder: RGB;
  borderFocus: RGB;
  accent: RGB;
  /** Dim text (timestamps): --text-dim (#319, US18). */
  textDim: RGB;
  /** Status text (pass, fail, warnings): the *-text tokens (#319, US18). */
  greenText: RGB;
  redText: RGB;
  orangeText: RGB;
  /** The raw token values, for comparing one set with another. */
  raw: { text: string; textMuted: string; border: string; borderFocus: string };
}

function buildResolved(values: Record<string, string>): ResolvedThemeTokens {
  const get = (name: string, fallback: string) =>
    resolveVars(values[name] ?? fallback, values);
  const bg = parseColor(get("--bg", "#000000"));
  const bgCard = parseColor(get("--bg-card", get("--bg", "#1c1c1e")));
  const rawBorder = parseColor(get("--border", "#888888"));
  const rawFocus = parseColor(get("--border-focus", "#0a84ff"));
  const rawAccent = parseColor(get("--accent", "#0a84ff"));
  const rawText = parseColor(get("--text", "#ffffff"));
  const rawMuted = parseColor(get("--text-muted", "#999999"));
  const rawDim = parseColor(get("--text-dim", "#707075"));
  // Before #319 status text used the bright icon tokens, so a missing *-text
  // token falls back to its bright counterpart: the gate fails until the text
  // tokens exist and hold their own colour.
  const rawGreenText = parseColor(
    get("--green-text", get("--green", "#28a745")),
  );
  const rawRedText = parseColor(get("--red-text", get("--red", "#d73a49")));
  const rawOrangeText = parseColor(
    get("--orange-text", get("--orange", "#ff9500")),
  );

  return {
    bg,
    bgCard,
    text: composite(rawText, bg),
    textMuted: composite(rawMuted, bg),
    border: composite(rawBorder, bg),
    controlBorder: composite(
      parseColor(get("--border-control", get("--border", "#888888"))),
      bg,
    ),
    borderFocus: composite(rawFocus, bg),
    accent: composite(rawAccent, bg),
    textDim: composite(rawDim, bg),
    greenText: composite(rawGreenText, bg),
    redText: composite(rawRedText, bg),
    orangeText: composite(rawOrangeText, bg),
    raw: {
      text: get("--text", "#ffffff"),
      textMuted: get("--text-muted", "#999999"),
      border: get("--border", "#888888"),
      borderFocus: get("--border-focus", "#0a84ff"),
    },
  };
}

const THEMES = [
  { id: "default", name: "Default" },
  { id: "graphite", name: "Graphite" },
  { id: "sandstone", name: "Sandstone" },
];
const APPEARANCES = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];
const CONTRASTS = [
  { id: "standard", name: "Standard" },
  { id: "more", name: "More contrast" },
];

describe("Theme Contrast Gates across theme × appearance × contrast (#248, #249)", () => {
  const TOKENS_PATH = path.resolve(
    import.meta.dir,
    "../src/frontend/styles/tokens.css",
  );
  const rules = parseRules(fs.readFileSync(TOKENS_PATH, "utf-8"));

  const sets = THEMES.flatMap((theme) =>
    APPEARANCES.flatMap((appearance) =>
      CONTRASTS.map((contrast) => ({
        name: `${theme.name} · ${appearance.name} · ${contrast.name}`,
        combo: {
          "data-theme": theme.id,
          "data-appearance": appearance.id,
          "data-contrast": contrast.id,
        },
      })),
    ),
  );

  it("covers all 12 theme × appearance × contrast sets", () => {
    expect(sets.length).toBe(12);
    expect(new Set(sets.map((s) => s.name)).size).toBe(12);
  });

  for (const { name, combo } of sets) {
    describe(name, () => {
      const tokens = buildResolved(cascade(rules, combo));

      it("meets 4.5:1 text contrast for primary and muted text against background", () => {
        const textRatio = contrastRatio(tokens.text, tokens.bg);
        const mutedRatio = contrastRatio(tokens.textMuted, tokens.bg);

        expect(textRatio).toBeGreaterThanOrEqual(4.5);
        expect(mutedRatio).toBeGreaterThanOrEqual(4.5);
      });

      it("meets 4.5:1 text contrast against card background", () => {
        const textCardRatio = contrastRatio(tokens.text, tokens.bgCard);
        const mutedCardRatio = contrastRatio(tokens.textMuted, tokens.bgCard);

        expect(textCardRatio).toBeGreaterThanOrEqual(4.5);
        expect(mutedCardRatio).toBeGreaterThanOrEqual(4.5);
      });

      it("meets 3:1 contrast for controls (accent) and focus rings", () => {
        const focusRingRatio = contrastRatio(tokens.borderFocus, tokens.bg);
        const focusRingCardRatio = contrastRatio(
          tokens.borderFocus,
          tokens.bgCard,
        );
        const accentRatio = contrastRatio(tokens.accent, tokens.bg);

        expect(focusRingRatio).toBeGreaterThanOrEqual(3.0);
        expect(focusRingCardRatio).toBeGreaterThanOrEqual(3.0);
        expect(accentRatio).toBeGreaterThanOrEqual(3.0);
      });

      it("meets 3:1 for control borders against background and card", () => {
        expect(
          contrastRatio(tokens.controlBorder, tokens.bg),
        ).toBeGreaterThanOrEqual(3.0);
        expect(
          contrastRatio(tokens.controlBorder, tokens.bgCard),
        ).toBeGreaterThanOrEqual(3.0);
      });

      it("meets 4.5:1 text contrast for dim and status text tokens (#319, US18)", () => {
        expect(contrastRatio(tokens.textDim, tokens.bg)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(tokens.textDim, tokens.bgCard),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.greenText, tokens.bg),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.greenText, tokens.bgCard),
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.redText, tokens.bg)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(tokens.redText, tokens.bgCard),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.orangeText, tokens.bg),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.orangeText, tokens.bgCard),
        ).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  describe("increased contrast changes text, borders and focus rings (#248)", () => {
    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        const standard = buildResolved(
          cascade(rules, {
            "data-theme": theme.id,
            "data-appearance": appearance.id,
            "data-contrast": "standard",
          }),
        );
        const more = buildResolved(
          cascade(rules, {
            "data-theme": theme.id,
            "data-appearance": appearance.id,
            "data-contrast": "more",
          }),
        );
        const label = `${theme.name} · ${appearance.name}`;

        it(`${label}: text is at least as strong as standard`, () => {
          expect(contrastRatio(more.text, more.bg)).toBeGreaterThanOrEqual(
            contrastRatio(standard.text, standard.bg),
          );
        });
        it(`${label}: muted text token differs from standard`, () => {
          expect(more.raw.textMuted).not.toBe(standard.raw.textMuted);
        });
        it(`${label}: border token differs from standard`, () => {
          expect(more.raw.border).not.toBe(standard.raw.border);
        });
        it(`${label}: focus ring token differs from standard`, () => {
          expect(more.raw.borderFocus).not.toBe(standard.raw.borderFocus);
        });
      }
    }
  });
});
