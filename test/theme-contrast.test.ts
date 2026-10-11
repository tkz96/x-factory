// test/theme-contrast.test.ts — Contrast verification across theme × appearance × contrast (#248).
// Requires 4.5:1 for body/muted text, and 3:1 for controls and focus rings.

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

interface ResolvedThemeTokens {
  bg: RGB;
  bgCard: RGB;
  text: RGB;
  textMuted: RGB;
  border: RGB;
  borderFocus: RGB;
  accent: RGB;
}

function extractThemeTokens(tokensCss: string): {
  lightStandard: ResolvedThemeTokens;
  lightMore: ResolvedThemeTokens;
  darkStandard: ResolvedThemeTokens;
  darkMore: ResolvedThemeTokens;
} {
  // Parse blocks from tokens.css
  function parseBlock(blockText: string): Record<string, string> {
    const tokens: Record<string, string> = {};
    for (const match of blockText.matchAll(
      /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g,
    )) {
      const prop = match[1];
      const val = match[2];
      if (prop && val) {
        tokens[prop] = val.trim();
      }
    }
    return tokens;
  }

  // Find blocks for each combination
  // Light standard tokens
  const lightBlock =
    tokensCss.match(/\[data-appearance="light"\][^{]*\{([^}]+)\}/)?.[1] ??
    tokensCss.match(/\[data-theme="light"\][^{]*\{([^}]+)\}/)?.[1] ??
    "";
  const lightTokens = parseBlock(lightBlock);

  // Light more contrast
  const lightMoreBlock =
    tokensCss.match(
      /\[data-appearance="light"\]\[data-contrast="more"\][^{]*\{([^}]+)\}/,
    )?.[1] ??
    tokensCss.match(/\[data-contrast="more"\][^{]*\{([^}]+)\}/)?.[1] ??
    "";
  const lightMoreTokens = { ...lightTokens, ...parseBlock(lightMoreBlock) };

  // Dark standard tokens
  const darkBlock =
    tokensCss.match(/\[data-appearance="dark"\][^{]*\{([^}]+)\}/)?.[1] ??
    tokensCss.match(/\[data-theme="dark"\][^{]*\{([^}]+)\}/)?.[1] ??
    "";
  const darkTokens = parseBlock(darkBlock);

  // Dark more contrast
  const darkMoreBlock =
    tokensCss.match(
      /\[data-appearance="dark"\]\[data-contrast="more"\][^{]*\{([^}]+)\}/,
    )?.[1] ?? "";
  const darkMoreTokens = { ...darkTokens, ...parseBlock(darkMoreBlock) };

  function buildResolved(t: Record<string, string>): ResolvedThemeTokens {
    const bg = parseColor(t["--bg"] ?? "#000000");
    const bgCard = parseColor(t["--bg-card"] ?? t["--bg"] ?? "#1c1c1e");
    const rawBorder = parseColor(t["--border"] ?? "#888888");
    const rawFocus = parseColor(t["--border-focus"] ?? "#0a84ff");
    const rawAccent = parseColor(t["--accent"] ?? "#0a84ff");
    const rawText = parseColor(t["--text"] ?? "#ffffff");
    const rawMuted = parseColor(t["--text-muted"] ?? "#999999");

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

  return {
    lightStandard: buildResolved(lightTokens),
    lightMore: buildResolved(lightMoreTokens),
    darkStandard: buildResolved(darkTokens),
    darkMore: buildResolved(darkMoreTokens),
  };
}

describe("Default Theme Contrast Gates across appearance × contrast (#248)", () => {
  const TOKENS_PATH = path.resolve(
    import.meta.dir,
    "../src/frontend/styles/tokens.css",
  );
  const tokensCss = fs.readFileSync(TOKENS_PATH, "utf-8");
  const themes = extractThemeTokens(tokensCss);

  const configs = [
    { name: "Light (Standard)", tokens: themes.lightStandard, isMore: false },
    { name: "Light (More Contrast)", tokens: themes.lightMore, isMore: true },
    { name: "Dark (Standard)", tokens: themes.darkStandard, isMore: false },
    { name: "Dark (More Contrast)", tokens: themes.darkMore, isMore: true },
  ];

  for (const { name, tokens, isMore } of configs) {
    describe(`${name}`, () => {
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
