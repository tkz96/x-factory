// test/provider-agnostic-gate.test.ts — Static provider-agnosticism gate (#141).
//
// Mechanically enforces that no provider-specific conditional, concrete
// provider lookup, or provider-module import exists outside the provider zone
// (src/providers/**). Consumers must dispatch through the registry and the
// capability type-guards; provider identity may only be branched on inside
// provider modules. Same allowlist pattern as the frontend-smoke inline-style
// gate: audited exceptions are listed explicitly below with reasons, and every
// new exemption must justify itself in review.
//
// The scanner is a pure function of (relative path, source text) — `scanContent`
// — so the gate's own rules are gated: the fixtures at the bottom prove each
// rule fires on the shape it claims to catch, and stays silent on legitimate
// generic code. `scanFile` is the thin wrapper the repository-wide scan uses.
//
// What counts as a violation:
//   1. a concrete provider lookup — `getProvider("github")`, `requireProvider("jira")`
//   2. a registry lookup by provider-id literal — `.get("azure")`
//   3. a provider-id literal in a comparison (`===`, `!==`, `==`, `!=`), a
//      `case`, or a ternary — on either side of the operator
//   4. a provider-id literal used to SELECT behaviour — `TABLES["azure"]`, a
//      computed key `{ ["azure"]: … }`, `case "azure":`
//   5. the legacy tracker/discovery/Azure/GitHub-client/provider-submodule imports
//
// Known precision boundary — provider-keyed TABLES. A record literal keyed by
// provider ids (`{ azure: matchAzure, github: matchGitHub }`) is data, not
// branching, and is not reported; using a provider id to SELECT from such a
// table is. The single instance outside the provider zone
// (`src/shared/project-identity.ts`) cannot delegate to the registry:
// `.fallowrc.json` lets `shared` import nothing and `frontend` import only
// `shared`, and the duplicate check runs in the browser, so the per-provider
// matchers have to live in the dependency-free zone.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "src");
const PROVIDER_ZONE = join(SRC_ROOT, "providers");
/** A relative path may be given with or without the leading `src/`. */
const SRC_PREFIX = "src/";

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

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

// The provider-id set is exactly the three built-in ids: a literal that is not
// one of them (`"content-type"` on a Headers object, the route id
// `"test-azure-scopes"`) is never a provider-identity match.

/** Branching on a provider id literal. */
const CONDITIONAL_RULES: readonly Rule[] = [
  {
    name: "equality on provider id",
    pattern: /[=!]==\s*["'](?:github|azure|jira)["']/,
  },
  {
    name: "loose equality on provider id",
    pattern: /(?:==|!=)(?!=)\s*["'](?:github|azure|jira)["']/,
  },
  {
    name: "comparison on provider id (literal first)",
    pattern: /["'](?:github|azure|jira)["']\s*[=!]==?(?!=)/,
  },
  {
    name: "switch case on provider id",
    pattern: /\bcase\s*["'](?:github|azure|jira)["']\s*:/,
  },
  {
    name: "ternary on provider id",
    pattern: /\?\s*["'](?:github|azure|jira)["']\s*:/,
  },
  {
    name: "provider-id map key selector",
    pattern:
      /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*["'](?:github|azure|jira)["']\s*\]/,
  },
  {
    name: "computed object key on provider id",
    pattern: /\[\s*["'](?:github|azure|jira)["']\s*\]\s*:/,
  },
];

/** Resolving a provider by a hardcoded id instead of by capability. */
const LOOKUP_RULES: readonly Rule[] = [
  {
    name: "concrete provider lookup",
    pattern:
      /\b(?:getProvider|requireProvider)\s*\(\s*["'](?:github|azure|jira)["']\s*[,)]/,
  },
  {
    name: "provider registry lookup by id literal",
    pattern: /\.get\(\s*["'](?:github|azure|jira)["']\s*[,)]/,
  },
];

/** Import specifiers that reach legacy families or provider module internals. */
const FORBIDDEN_IMPORT_RULES: readonly Rule[] = [
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

export interface Violation {
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

/**
 * Path segments that mark a path as a test artifact rather than shipped source:
 * the gate guards the code the runtime runs. `scanContent` is also called with
 * fixture paths, which must stay out of scope.
 */
const NON_SOURCE_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "__fixtures__",
]);

/** Normalizes a path to the gate's canonical form: `src/`-stripped, POSIX. */
function normalizeRelPath(relPath: string): string {
  const unified = relPath.split("\\").join("/").replace(/^\.\//, "");
  return unified.startsWith(SRC_PREFIX)
    ? unified.slice(SRC_PREFIX.length)
    : unified;
}

/** The provider zone: provider-specific code is exactly what belongs here. */
function isProviderZone(relPath: string): boolean {
  return relPath === "providers" || relPath.startsWith("providers/");
}

/** Only production source inside the scanned tree is in scope. */
function isScannedSource(relPath: string): boolean {
  if (
    !relPath ||
    relPath.startsWith("/") ||
    relPath.startsWith("../") ||
    relPath.includes("/../")
  ) {
    return false;
  }
  if (relPath.split("/").some((segment) => NON_SOURCE_SEGMENTS.has(segment))) {
    return false;
  }
  return !/\.[cm]?(?:test|spec)\.[tj]sx?$/.test(relPath);
}

/** Matches a rule over the whole content (so wrapped calls are still caught). */
function matchRules(
  relPath: string,
  content: string,
  rules: readonly Rule[],
): Violation[] {
  const lines = content.split("\n");
  const violations: Violation[] = [];
  for (const rule of rules) {
    for (const match of content.matchAll(
      new RegExp(rule.pattern.source, "g"),
    )) {
      const index = match.index ?? 0;
      const line = content.slice(0, index).split("\n").length;
      violations.push({
        file: relPath,
        line,
        text: (lines[line - 1] ?? "").trim(),
        rule: rule.name,
      });
    }
  }
  return violations;
}

function isImportLine(text: string): boolean {
  return /^\s*import\b/.test(text) || /^\s*export\b.*\bfrom\b/.test(text);
}

/**
 * The gate as a pure function of (relative path, source text).
 *
 * The zone rule and the allowlist are decided from the path alone, so a
 * fixture proves both acceptance and rejection by varying the path while the
 * content stays identical. `relPath` is relative to `src/`; a leading `src/`
 * is tolerated so callers can pass either form.
 *
 * Import rules never apply to allowlisted files (they are content-only);
 * conditional and lookup rules are skipped for them too — the entry is audited
 * as a whole.
 */
export function scanContent(relPath: string, content: string): Violation[] {
  const path = normalizeRelPath(relPath);
  if (!isScannedSource(path) || isProviderZone(path)) return [];
  if (path in ALLOWED_FILES) return [];

  const violations = matchRules(path, content, [
    ...CONDITIONAL_RULES,
    ...LOOKUP_RULES,
  ]);

  const lines = content.split("\n");
  lines.forEach((text, index) => {
    if (!isImportLine(text)) return;
    for (const rule of FORBIDDEN_IMPORT_RULES) {
      if (rule.pattern.test(text)) {
        violations.push({
          file: path,
          line: index + 1,
          text: text.trim(),
          rule: rule.name,
        });
      }
    }
  });

  return violations.sort((a, b) => a.line - b.line);
}

/** Reads a source file and scans it. */
export function scanFile(path: string): Violation[] {
  return scanContent(relative(SRC_ROOT, path), readFileSync(path, "utf8"));
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

// ─── Fixtures: the gate's own rules are gated (#141 self-test) ───────────────
//
// Every negative fixture MUST be reported under the rule named with it. Every
// positive fixture MUST produce zero violations. The positive fixtures carry
// the SAME provider-specific content as the negative ones wherever the point is
// the path: acceptance is decided by the path, never by the content being
// harmless.

/** Content that is provider-specific on purpose — legal only inside the zone. */
const PROVIDER_SPECIFIC_FIXTURE_CONTENT = [
  'import { azureProvider } from "../providers/azure-module.js";',
  "",
  "export function pick(providerId: string) {",
  '  const concrete = getProvider("azure");',
  '  if (providerId === "github") return concrete;',
  '  const handlers = { jira: () => "j" };',
  '  return handlers["jira"];',
  "}",
  "",
].join("\n");

interface Fixture {
  readonly case: string;
  readonly path: string;
  readonly content: string;
}

const NEGATIVE_FIXTURES: ReadonlyArray<Fixture & { readonly rule: string }> = [
  {
    case: "a concrete provider lookup",
    path: "http/example-controller.ts",
    content: 'const provider = getProvider("github");\n',
    rule: "concrete provider lookup",
  },
  {
    case: "a concrete provider lookup wrapped onto two lines",
    path: "services/example-service.ts",
    content: 'const provider = requireProvider(\n  "jira",\n);\n',
    rule: "concrete provider lookup",
  },
  {
    case: "a registry lookup by provider-id literal",
    path: "http/example-controller.ts",
    content: 'const provider = PROVIDER_REGISTRY.get("azure");\n',
    rule: "provider registry lookup by id literal",
  },
  {
    case: "a provider-id equality comparison",
    path: "http/example-controller.ts",
    content:
      'if (project.issueTracker?.provider === "github") {\n  return "gh";\n}\n',
    rule: "equality on provider id",
  },
  {
    case: "a provider-id comparison with the literal first",
    path: "http/example-controller.ts",
    content: 'if ("azure" !== requestedProviderId) {\n  return null;\n}\n',
    rule: "comparison on provider id (literal first)",
  },
  {
    case: "a loose provider-id comparison",
    path: "executors/example.ts",
    content: 'if (providerId == "jira") {\n  return null;\n}\n',
    rule: "loose equality on provider id",
  },
  {
    case: "a switch on provider id",
    path: "executors/example.ts",
    content:
      'switch (providerId) {\n  case "azure":\n    return runVendorCall();\n}\n',
    rule: "switch case on provider id",
  },
  {
    case: "a ternary selecting a provider-id value",
    path: "http/example-controller.ts",
    content: 'const label = isTracker ? "github" : guessLabel();\n',
    rule: "ternary on provider id",
  },
  {
    case: "provider-specific branching by selecting from a provider-keyed record",
    path: "executors/example.ts",
    content: 'const branch = HANDLERS["jira"];\n',
    rule: "provider-id map key selector",
  },
  {
    case: "an object key chosen by provider identity",
    path: "http/example-controller.ts",
    content: 'const map = { ["azure"]: config, ["github"]: config };\n',
    rule: "computed object key on provider id",
  },
  {
    case: "a legacy provider-submodule import",
    path: "http/example-controller.ts",
    content:
      'import { githubProvider } from "../providers/github-module.js";\n',
    rule: "provider submodule import",
  },
];

describe("provider-agnosticism gate — negative fixtures (must be reported)", () => {
  for (const fixture of NEGATIVE_FIXTURES) {
    it(`reports ${fixture.case}`, () => {
      const violations = scanContent(fixture.path, fixture.content);
      expect(
        violations.map((violation) => violation.rule),
        `${fixture.path} was not reported under "${fixture.rule}"`,
      ).toContain(fixture.rule);
      expect(violations[0]?.file).toBe(fixture.path);
      expect(violations[0]?.line).toBeGreaterThan(0);
    });
  }
});

// ─── Positive fixtures: legitimate generic code stays allowed ────────────────

/**
 * A generic consumer that depends on capabilities and contracts: dynamic lookup
 * by a requested id, capability dispatch, and `Headers.get("content-type")` —
 * the collision the id-literal narrowing exists to avoid.
 */
const GENERIC_CONSUMER = [
  'import { hasCapability, type ProviderConfig } from "../providers/contract.js";',
  'import { getProvider, type ProviderRegistry } from "../providers/registry.js";',
  "",
  "export async function inspectRepositories(",
  "  requestedProviderId: string,",
  "  req: Request,",
  "  registry: ProviderRegistry,",
  ") {",
  "  const provider = getProvider(requestedProviderId, registry);",
  '  if (!provider || !hasCapability(provider, "listRepositories")) {',
  "    return { repositories: [], descriptor: undefined };",
  "  }",
  '  const contentType = req.headers.get("content-type");',
  "  const repositories = await provider.listRepositories({} as ProviderConfig);",
  "  // The id is read off the provider as DATA and forwarded, never compared.",
  "  return {",
  "    repositories,",
  "    contentType,",
  "    descriptor: { providerId: provider.id, displayName: provider.displayName },",
  "  };",
  "}",
  "",
].join("\n");

/**
 * A provider-keyed table read by a variable key: the ids are data keys, and the
 * selection is by the identity recorded on the project, not by a literal. This
 * is the documented precision boundary in the header — the shape of
 * `src/shared/project-identity.ts`, which cannot delegate to the registry.
 */
const PROVIDER_KEYED_TABLE = [
  "type Matcher = (project: Project) => boolean;",
  "",
  "const matchers: Record<string, Matcher> = {",
  "  azure: matchesAzureIdentity,",
  "  github: matchesGitHubIdentity,",
  "};",
  "",
  "const matcher = matchers[normalizedProviderId];",
  "",
].join("\n");

const POSITIVE_FIXTURES: readonly Fixture[] = [
  {
    case: "provider-specific content under the provider-zone path",
    path: "providers/github-module.ts",
    content: PROVIDER_SPECIFIC_FIXTURE_CONTENT,
  },
  {
    case: "provider-specific content under a src/-prefixed provider-zone path",
    path: "src/providers/azure-module.ts",
    content: PROVIDER_SPECIFIC_FIXTURE_CONTENT,
  },
  {
    case: "provider-specific content in an allowlisted content-only file",
    path: "frontend/views/DocsView.tsx",
    content: PROVIDER_SPECIFIC_FIXTURE_CONTENT,
  },
  {
    case: "provider-specific content behind a test-fixture path",
    path: "../test/fixtures/provider-coupling.ts",
    content: PROVIDER_SPECIFIC_FIXTURE_CONTENT,
  },
  {
    case: "provider-specific content in a test file",
    path: "http/example.test.ts",
    content: PROVIDER_SPECIFIC_FIXTURE_CONTENT,
  },
  {
    case: "a generic consumer dispatching on capabilities",
    path: "http/example-controller.ts",
    content: GENERIC_CONSUMER,
  },
  {
    case: "a provider-keyed table read by a variable key",
    path: "shared/example-identity.ts",
    content: PROVIDER_KEYED_TABLE,
  },
];

describe("provider-agnosticism gate — positive fixtures (must stay allowed)", () => {
  for (const fixture of POSITIVE_FIXTURES) {
    it(`does not report ${fixture.case}`, () => {
      expect(
        scanContent(fixture.path, fixture.content),
        `${fixture.path} was reported`,
      ).toEqual([]);
    });
  }
});
