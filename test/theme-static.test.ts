// test/theme-static.test.ts — Static checks for the Theme choice and theme fonts (#249).
// The pre-paint script applies the stored theme before React loads, and a
// theme's fonts are declared only with that theme's font stacks, so they
// download only when that theme is active.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const tokens = fs.readFileSync(
  path.join(ROOT, "src/frontend/styles/tokens.css"),
  "utf-8",
);
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");

/** The declaration body of the first rule whose selector matches exactly. */
function ruleBody(selector: string): string {
  const start = tokens.indexOf(`${selector} {`);
  if (start === -1) return "";
  const open = tokens.indexOf("{", start);
  return tokens.slice(open + 1, tokens.indexOf("}", open));
}

function fontFaceFamilies(): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const block of tokens.matchAll(/@font-face \{([^}]*)\}/g)) {
    const body = block[1] ?? "";
    const family = body.match(/font-family:\s*"([^"]+)"/)?.[1];
    const src = [...body.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] ?? "");
    if (family) families.set(family, [...(families.get(family) ?? []), ...src]);
  }
  return families;
}

describe("Theme choice before first paint (#249)", () => {
  it("the pre-paint script reads the stored Theme and applies only known themes", () => {
    expect(indexHtml).toContain('localStorage.getItem("xf_theme_choice")');
    expect(indexHtml).toContain('s==="graphite"');
    expect(indexHtml).toContain('s==="sandstone"');
    expect(indexHtml).toContain('root.setAttribute("data-theme",t)');
  });
});

describe("theme fonts (#249)", () => {
  it("Default uses system-ui then the bundled Inter, with IBM Plex Mono for code", () => {
    const display = ruleBody(":root");
    expect(display).toMatch(
      /--font-sans:\s*system-ui,\s*"Inter",\s*sans-serif;/,
    );
    expect(display).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
  });

  it("Graphite and Sandstone name only their own families", () => {
    const graphite = ruleBody('[data-theme="graphite"]');
    const sandstone = ruleBody('[data-theme="sandstone"]');
    expect(graphite).toContain('"IBM Plex Sans"');
    expect(graphite).toContain('"IBM Plex Mono"');
    expect(sandstone).toContain('"Atkinson Hyperlegible Next"');
    expect(sandstone).toContain('"Atkinson Hyperlegible Mono"');
    expect(sandstone).not.toContain("IBM Plex");
    expect(graphite).not.toContain("Atkinson");
  });

  it("every theme font face points at a woff2 file that is bundled with the app", () => {
    const families = fontFaceFamilies();
    for (const family of [
      "IBM Plex Sans",
      "Atkinson Hyperlegible Next",
      "Atkinson Hyperlegible Mono",
    ]) {
      const sources = families.get(family) ?? [];
      expect(sources.length).toBe(4);
      for (const src of sources) {
        expect(src.startsWith("/fonts/")).toBe(true);
        expect(fs.existsSync(path.join(ROOT, "public", src))).toBe(true);
      }
    }
  });

  it("a font face is only ever used by the theme that names it", () => {
    // Default must not name a theme-only family, so its files never download
    // unless a theme is active.
    const defaultStack = ruleBody(":root");
    expect(defaultStack).not.toContain("IBM Plex Sans");
    expect(defaultStack).not.toContain("Atkinson");
  });
});

describe("open font licences (#249)", () => {
  it("ships the SIL Open Font License text next to the bundled fonts", () => {
    const dir = path.join(ROOT, "public/fonts");
    expect(
      fs.readFileSync(path.join(dir, "OFL-ibm-plex.txt"), "utf-8"),
    ).toContain("SIL Open Font License");
    expect(
      fs.readFileSync(path.join(dir, "OFL-atkinson.txt"), "utf-8"),
    ).toContain("SIL Open Font License");
  });
});
