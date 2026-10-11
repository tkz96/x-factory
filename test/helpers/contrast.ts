// test/helpers/contrast.ts — WCAG contrast arithmetic, shared by the theme
// contrast gate (test/theme-contrast.test.ts) and the block gate
// (test/ui-loading-states.test.tsx), so both measure the same way.

export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(raw: string): RGB {
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

export function composite(fg: RGB, bg: RGB): RGB {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

export function relativeLuminance(c: RGB): number {
  const srgb = [c.r / 255, c.g / 255, c.b / 255].map((val) => {
    return val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4;
  });
  const rLum = srgb[0] ?? 0;
  const gLum = srgb[1] ?? 0;
  const bLum = srgb[2] ?? 0;
  return 0.2126 * rLum + 0.7152 * gLum + 0.0722 * bLum;
}

export function contrastRatio(colorA: RGB, colorB: RGB): number {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
