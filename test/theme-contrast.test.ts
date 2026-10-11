// test/theme-contrast.test.ts — Contrast verification across theme × appearance × contrast (#248, #249).
// Requires 4.5:1 for body/muted text, and 3:1 for controls and focus rings.
// The twelve sets (Default, Graphite, Sandstone × Light, Dark × Standard, More)
// are resolved the way the browser cascades tokens.css: matching rules in
// specificity and source order, with var() references followed.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(raw: string): RGB {
  const str = raw.trim();
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const h0 = hex[0] ?? "0";
      const h1 = hex[1] ?? "0";
      const h2 = hex[2] ?? "0";
      const h3 = hex[3] ?? "f";
      const r = parseInt(h0 + h0, 16);
      const g = parseInt(h1 + h1, 16);
      const b = parseInt(h2 + h2, 16);
      const a = hex.length === 4 ? parseInt(h3 + h3, 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }

  const rgbaMatch = str.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (rgbaMatch) {
    const r = parseFloat(rgbaMatch[1] ?? "0");
    const g = parseFloat(rgbaMatch[2] ?? "0");
    const b = parseFloat(rgbaMatch[3] ?? "0");
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    return { r, g, b, a };
  }

  throw new Error(`Unrecognized color format: "${str}"`);
}

function composite(fg: RGB, bg: RGB): RGB {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function relativeLuminance(c: RGB): number {
  const srgb = [c.r / 255, c.g / 255, c.b / 255].map((val) => {
    return val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4;
  });
  const rLum = srgb[0] ?? 0;
  const gLum = srgb[1] ?? 0;
  const bLum = srgb[2] ?? 0;
  return 0.2126 * rLum + 0.7152 * gLum + 0.0722 * bLum;
}

function contrastRatio(colorA: RGB, colorB: RGB): number {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

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
  borderFocus: RGB;
  accent: RGB;
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

  return {
    bg,
    bgCard,
    text: composite(rawText, bg),
    textMuted: composite(rawMuted, bg),
    border: composite(rawBorder, bg),
    borderFocus: composite(rawFocus, bg),
    accent: composite(rawAccent, bg),
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
        isMore: contrast.id === "more",
      })),
    ),
  );

  it("covers all 12 theme × appearance × contrast sets", () => {
    expect(sets.length).toBe(12);
    expect(new Set(sets.map((s) => s.name)).size).toBe(12);
  });

  for (const { name, combo, isMore } of sets) {
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

      if (isMore) {
        it("increased contrast provides at least 3:1 for borders against background", () => {
          const borderRatio = contrastRatio(tokens.border, tokens.bg);
          expect(borderRatio).toBeGreaterThanOrEqual(3.0);
        });
      }
    });
  }
});
