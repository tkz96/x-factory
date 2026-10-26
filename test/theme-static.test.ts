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

describe("theme fonts (#249, spec #292)", () => {
  it("off Apple platforms the stack is the bundled Inter and IBM Plex Mono, with no system font name", () => {
    // Chromium treats BlinkMacSystemFont as system-ui on every platform, so a
    // system name here would give Windows Segoe UI and Linux Cantarell.
    const root = ruleBody(":root").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(root).toMatch(/--font-sans:\s*"Inter",\s*sans-serif;/);
    expect(root).toMatch(
      /--font-mono:\s*"IBM Plex Mono",\s*ui-monospace,\s*monospace;/,
    );
    for (const name of ["-apple-system", "BlinkMacSystemFont", "system-ui"]) {
      expect(root).not.toContain(name);
    }
  });

  it("on Apple platforms the stack is the system font, then Inter, with SF Mono first", () => {
    const apple = ruleBody(':root[data-platform="apple"]');
    expect(apple).toMatch(
      /--font-sans:\s*-apple-system,\s*BlinkMacSystemFont,\s*system-ui,\s*"Inter",\s*sans-serif;/,
    );
    expect(apple).toMatch(
      /--font-mono:\s*ui-monospace,\s*"SF Mono",\s*Menlo,\s*"IBM Plex Mono",\s*monospace;/,
    );
  });

  it("the pre-paint script marks Apple platforms before the first paint", () => {
    expect(indexHtml).toContain('setAttribute("data-platform","apple")');
    expect(indexHtml).toMatch(/\/mac\|iphone\|ipad\|ipod\/i\.test\(pf\)/);
  });

  it("themes change colour only: no theme sets a font token", () => {
    for (const theme of [
      '[data-theme="graphite"]',
      '[data-theme="sandstone"]',
    ]) {
      const body = ruleBody(theme);
      expect(body).not.toMatch(/--font-/);
    }
  });

  it("the readable font is set by data-font, not by a theme", () => {
    const readable = ruleBody('[data-font="readable"]');
    expect(readable).toContain('"Atkinson Hyperlegible Next"');
    expect(readable).toContain('"Atkinson Hyperlegible Mono"');
  });

  it("every font face points at a woff2 file that is bundled with the app", () => {
    const families = fontFaceFamilies();
    for (const family of [
      "Inter",
      "IBM Plex Mono",
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

  it("IBM Plex Sans is no longer declared or bundled", () => {
    expect(tokens).not.toContain("IBM Plex Sans");
    expect(
      fs.existsSync(path.join(ROOT, "public/fonts/IBMPlexSans-Regular.woff2")),
    ).toBe(false);
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
