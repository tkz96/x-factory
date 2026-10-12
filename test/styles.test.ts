// test/styles.test.ts — Automated gate for CSS token consolidation and !important governance (XF-020).
//
// Scans the design system the app ships (src/frontend, every stylesheet) now that
// the pre-redesign public/styles.css is retired (#248). The token files are the
// only place a colour or a !important may be defined, apart from the one WHATWG
// [hidden] rule.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const FRONTEND_DIR = path.join(import.meta.dir, "../src/frontend");
const TOKEN_FILE = path.join(FRONTEND_DIR, "styles/tokens.css");

function listStylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listStylesheets(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const STYLESHEETS = listStylesheets(FRONTEND_DIR);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
}

describe("CSS Token Consolidation & Style Governance (src/frontend stylesheets)", () => {
  it("finds the design system stylesheets it governs", () => {
    expect(STYLESHEETS).toContain(TOKEN_FILE);
    expect(STYLESHEETS.length).toBeGreaterThan(50);
  });

  it("contains zero hex color literals outside the token file", () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of STYLESHEETS) {
      if (file === TOKEN_FILE) continue;
      // Comments cite issues (#268), so they are not styles.
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Look for hex color literals (#fff, #123456, etc.)
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
          violations.push({
            file: path.relative(FRONTEND_DIR, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("contains zero undocumented !important declarations and only allows [hidden]", () => {
    const importantLines: { file: string; line: number; text: string }[] = [];
    const precedingByFile = new Map<string, string>();

    for (const file of STYLESHEETS) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.includes("!important")) {
          const rel = path.relative(FRONTEND_DIR, file);
          importantLines.push({ file: rel, line: i + 1, text: line.trim() });
          precedingByFile.set(
            rel,
            lines.slice(Math.max(0, i - 5), i).join("\n"),
          );
        }
      }
    }

    // Exactly one !important is allowed and must be the WHATWG HTML5 hidden spec rule
    expect(importantLines.length).toBe(1);
    expect(importantLines[0]?.file).toBe(path.join("styles", "base.css"));
    expect(importantLines[0]?.text).toBe("display: none !important;");

    // Verify documentation preceding it
    const preceding = precedingByFile.get(importantLines[0]?.file ?? "") ?? "";
    expect(preceding).toContain("WHATWG HTML5 Spec: [hidden]");
  });
});
