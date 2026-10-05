// test/provider-agnostic-gate.test.ts — Static provider-agnosticism gate (#141).
//
// Mechanically enforces that no provider-specific conditional or provider-module
// import exists outside the provider zone (src/providers/**). Consumers must
// dispatch through the registry and capability type-guards; provider identity may
// only be branched on inside provider modules. Same allowlist pattern as the
// frontend-smoke inline-style gate: audited exceptions are listed explicitly
// below with reasons, and every new exemption must justify itself in review.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "src");
const PROVIDER_ZONE = join(SRC_ROOT, "providers");

/**
 * File-level exemptions (relative to src/), each with an audited reason.
 * Keep this list SHORT — a growing list means the architecture is leaking.
 */
const ALLOWED_FILES: Readonly<Record<string, string>> = {
  "frontend/views/DocsView.tsx":
    "per-provider security documentation content UI — renders static copy only, imports no provider module, dispatches no provider behavior",
  "frontend/components/docs/DocsSidebarNav.tsx":
    "static navigation entries for the provider documentation pages — data list, no branching on provider behavior",
};

/** Conditionals that branch on a provider id literal. */
const CONDITIONAL_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "equality on provider id",
    pattern: /[=!]==\s*"(?:github|azure|jira)"/,
  },
  {
    name: "switch case on provider id",
    pattern: /\bcase\s*"(?:github|azure|jira)"\s*:/,
  },
  {
    name: "ternary on provider id",
    pattern: /\?\s*"(?:github|azure|jira)"\s*:/,
  },
];

/** Import specifiers that reach legacy families or provider module internals. */
const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
}> = [
  {
    name: "legacy tracker layer import",
    pattern: /(?:^|[/\\])trackers(?:[/\\]|\.js)/,
  },
  {
    name: "legacy discovery layer import",
    pattern: /(?:^|[/\\])discovery(?:[/\\]|\.js)/,
  },
  { name: "legacy github client import", pattern: /(?:^|[/\\])github\.js/ },
  {
    name: "legacy azure family import",
    pattern: /(?:^|[/\\])azure-[a-z]+\.js/,
  },
  {
    name: "provider submodule import",
    pattern:
      /(?:^|[/\\])providers[/\\](?:github|azure|jira)(?:-module)?(?:[/\\]|\.js)/,
  },
];

interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (full === PROVIDER_ZONE) continue; // provider zone: allowed to be provider-specific
      out.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(path: string): Violation[] {
  const rel = relative(SRC_ROOT, path);
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");

  // Import rules never apply to allowlisted files (they are content-only);
  // conditional rules are skipped for them too — the entry is audited as a whole.
  if (rel in ALLOWED_FILES) return [];

  const violations: Violation[] = [];
  lines.forEach((text, index) => {
    const lineNumber = index + 1;
    for (const rule of CONDITIONAL_PATTERNS) {
      if (rule.pattern.test(text)) {
        violations.push({
          file: rel,
          line: lineNumber,
          text: text.trim(),
          rule: rule.name,
        });
      }
    }
    const isImportLine =
      /^\s*import\b/.test(text) || /^\s*export\b.*\bfrom\b/.test(text);
    if (isImportLine) {
      for (const rule of FORBIDDEN_IMPORT_PATTERNS) {
        if (rule.pattern.test(text)) {
          violations.push({
            file: rel,
            line: lineNumber,
            text: text.trim(),
            rule: rule.name,
          });
        }
      }
    }
  });
  return violations;
}

describe("provider-agnosticism gate (spec #133, ticket #141)", () => {
  it("no provider conditionals or provider-module imports exist outside src/providers/", () => {
    const violations = listSourceFiles(SRC_ROOT).flatMap(scanFile);
    const formatted = violations
      .map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}`)
      .join("\n");
    expect(
      violations.length,
      formatted
        ? `provider-agnostic gate violations:\n${formatted}\n` +
            "Consumers must dispatch via the registry + capability type-guards. " +
            "If this file is a genuine content-only exception, add it to ALLOWED_FILES in " +
            "test/provider-agnostic-gate.test.ts with a reason and get it reviewed."
        : "no violations",
    ).toBe(0);
  });

  it("every allowlisted file still exists — the allowlist may not rot", () => {
    for (const rel of Object.keys(ALLOWED_FILES)) {
      const path = join(SRC_ROOT, rel);
      expect(
        path,
        `allowlisted file ${rel} no longer exists — remove its entry`,
      ).toBeTruthy();
      expect(
        statSync(path).isFile(),
        `allowlisted file ${rel} no longer exists — remove its entry`,
      ).toBe(true);
    }
  });
});
