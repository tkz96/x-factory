// test/styles.test.ts — Automated gate for CSS token consolidation and !important governance (XF-020).

import { describe, expect, it } from "bun:test";
import path from "node:path";

const STYLES_PATH = path.join(import.meta.dir, "../public/styles.css");

describe("CSS Token Consolidation & Style Governance (public/styles.css)", () => {
  it("contains zero hex color literals outside :root and [data-theme] token definition blocks", async () => {
    const cssText = await Bun.file(STYLES_PATH).text();
    const lines = cssText.split("\n");

    let inTokenBlock = false;
    const violations: { line: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();

      // Track token definition blocks
      if (
        trimmed.startsWith(":root") ||
        trimmed.startsWith('[data-theme="dark"]') ||
        trimmed.startsWith('[data-theme="light"]')
      ) {
        inTokenBlock = true;
      }

      if (inTokenBlock && trimmed.endsWith("}") && !trimmed.includes("{")) {
        inTokenBlock = false;
        continue;
      }

      if (!inTokenBlock) {
        // Look for hex color literals (#fff, #123456, etc.)
        const match = line.match(/#[0-9a-fA-F]{3,8}\b/);
        if (match) {
          violations.push({ line: i + 1, text: line.trim() });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("contains zero undocumented !important declarations and only allows [hidden]", async () => {
    const cssText = await Bun.file(STYLES_PATH).text();
    const lines = cssText.split("\n");

    const importantLines: { line: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes("!important")) {
        importantLines.push({ line: i + 1, text: line.trim() });
      }
    }

    // Exactly one !important is allowed and must be the WHATWG HTML5 hidden spec rule
    expect(importantLines.length).toBe(1);
    expect(importantLines[0]?.text).toBe("display: none !important;");

    // Verify documentation preceding it
    const precedingText = lines
      .slice(
        Math.max(0, (importantLines[0]?.line ?? 1) - 5),
        importantLines[0]?.line ?? 1,
      )
      .join("\n");
    expect(precedingText).toContain("WHATWG HTML5 Spec: [hidden]");
  });
});
