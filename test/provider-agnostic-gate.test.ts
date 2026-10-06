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
// Known precision boundaries — recorded, not hidden. A record literal keyed by
// provider ids (`{ azure: matchAzure, github: matchGitHub }`) is data, not
// branching, and is not reported; using a provider id to SELECT from such a
// table is. Provider-id PROPERTY ACCESS (`p.issueTracker?.azure`) is likewise
// not reported: the shape appears legitimately in the legacy tracker view, and
// the single instance in the dependency-free zone
// (`src/shared/project-identity.ts`) cannot delegate to the registry because
// `.fallowrc.json` lets `shared` import nothing while the duplicate check runs
// in the browser. Both boundaries are stated in
// `docs/reference/provider-api.md` §5.
//
// ALLOWED_FILES entries are RULE-SCOPED: an entry names the rules its audited
// reason covers, and every other rule still applies to that file. A file-level
// "skip everything" exemption is not expressible, and a second test proves each
// entry is still needed (the named rules exist, and the file still violates
// them). Import rules read the whole file, so a wrapped import is caught.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "src");
const PROVIDER_ZONE = join(SRC_ROOT, "providers");
/** A relative path may be given with or without the leading `src/`. */
const SRC_PREFIX = "src/";

/**
 * A reviewed exemption for ONE file, covering ONLY the rules its reason
 * justifies.
 *
 * A file-level "skip everything" exemption was how `DocsView.tsx` slipped
 * through with a reason that was not true of it: the page contains a `switch` on
 * the docs URL slug, so it DOES hold provider-id literals, while its stated
 * reason was "renders static copy only … dispatches no provider behavior". Every
 * other rule now still applies to it — a provider lookup or a provider-module
 * import in that file is reported like any other file's.
 */
interface AllowedFile {
  /** Why these rules, in this file, are reviewed and accepted. */
  readonly reason: string;
  /** The rule names the reason covers. Nothing else is exempted. */
  readonly rules: readonly string[];
}

/**
 * File-level exemptions (relative to src/), each with an audited reason and the
 * exact rules it covers. Keep this list SHORT — a growing list means the
 * architecture is leaking, and an entry covering rules it does not need is a
 * hole.
 */
const ALLOWED_FILES: Readonly<Record<string, AllowedFile>> = {
  "frontend/views/DocsView.tsx": {
    reason:
      "per-provider security DOCUMENTATION: the docs URL slug (`?cat=security&slug=azure`) selects which static article is rendered, so the slug is compared against provider names to pick copy, and no provider module is imported, no provider is looked up and no provider capability is dispatched",
    rules: ["switch case on provider id", "equality on provider id"],
  },
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
    pattern: /(?<![=!])(?:==|!=)(?!=)\s*["'](?:github|azure|jira)["']/,
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
    pattern: /[ \t]*\?[ \t]*["'](?:github|azure|jira)["'][ \t]*:/,
  },
  {
    name: "provider-id map key selector",
    pattern:
      /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*[ \t]*\[[ \t]*["'](?:github|azure|jira)["'][ \t]*\]/,
  },
  {
    name: "computed object key on provider id",
    pattern: /\[[ \t]*["'](?:github|azure|jira)["'][ \t]*\][ \t]*:/,
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

/** One import specifier found in the source, and where it starts. */
interface ImportSpecifier {
  readonly specifier: string;
  readonly index: number;
}

/**
 * The import specifiers of a source file, matched over the WHOLE content rather
 * than line by line.
 *
 * A line-based check silently missed the house-style WRAPPED import — the
 * specifier sits on the `} from "…"` line, which is neither an `import` line nor
 * an `export … from` line — so this:
 *
 *     import {
 *       githubProvider,
 *     } from "../providers/github-module.js";
 *
 * escaped the import rules while the docs claim those import families are
 * covered. Each pattern below therefore spans newlines, and `[^;]*?` keeps a
 * match inside ONE statement: it cannot run past a terminator into the next
 * import's specifier.
 *
 * Three shapes are read: `import … from "x"` / `export … from "x"`, a bare
 * `import "x"`, and a dynamic `import("x")`. The rules are then tested against
 * the SPECIFIER alone — the string that will be resolved — never against the
 * whole statement, so a comment or an identifier that merely mentions a path
 * cannot produce a violation.
 */
const IMPORT_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importSpecifiers(content: string): ImportSpecifier[] {
  const found: ImportSpecifier[] = [];
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      found.push({
        specifier,
        // The specifier's own offset, so the reported line is the one carrying
        // the path (which is what makes a wrapped import legible).
        index: (match.index ?? 0) + match[0].indexOf(specifier),
      });
    }
  }
  return found;
}

/**
 * The gate as a pure function of (relative path, source text).
 *
 * The zone rule and the allowlist are decided from the path alone, so a
 * fixture proves both acceptance and rejection by varying the path while the
 * content stays identical. `relPath` is relative to `src/`; a leading `src/`
 * is tolerated so callers can pass either form.
 *
 * An allowlist entry exempts the rules it NAMES for that file, and nothing else
 * (#133 correction 1): the remaining conditional, lookup and import rules still
 * run, so a copy-selection exemption cannot hide a provider lookup or a
 * provider-module import.
 */
export function scanContent(relPath: string, content: string): Violation[] {
  const path = normalizeRelPath(relPath);
  if (!isScannedSource(path) || isProviderZone(path)) return [];
  const exempt: readonly string[] = ALLOWED_FILES[path]?.rules ?? [];
  const isExempt = (rule: string) => exempt.includes(rule);

  const violations = matchRules(
    path,
    content,
    [...CONDITIONAL_RULES, ...LOOKUP_RULES].filter(
      (rule) => !isExempt(rule.name),
    ),
  );

  const lines = content.split("\n");
  for (const { specifier, index } of importSpecifiers(content)) {
    const line = content.slice(0, index).split("\n").length;
    for (const rule of FORBIDDEN_IMPORT_RULES) {
      if (isExempt(rule.name)) continue;
      if (!rule.pattern.test(specifier)) continue;
      violations.push({
        file: path,
        line,
        text: (lines[line - 1] ?? "").trim(),
        rule: rule.name,
      });
    }
  }

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

  it("every allowlisted file still needs the rules it is exempted for", () => {
    // Two ways an exemption rots, both caught here: naming a rule that does not
    // exist (which would silently excuse nothing and read as a hole), and
    // keeping a rule the file no longer violates (a dead entry that only widens
    // the hole).
    const knownRules = new Set(
      [...CONDITIONAL_RULES, ...LOOKUP_RULES, ...FORBIDDEN_IMPORT_RULES].map(
        (rule) => rule.name,
      ),
    );
    for (const [rel, entry] of Object.entries(ALLOWED_FILES)) {
      for (const rule of entry.rules) {
        expect(
          knownRules,
          `unknown rule "${rule}" in the ${rel} entry`,
        ).toContain(rule);
      }
      // Read the file WITHOUT its exemption (a path that is not listed) and see
      // which rules it actually violates.
      const reported = new Set(
        scanContent(
          `exemption-check/${rel}`,
          readFileSync(join(SRC_ROOT, rel), "utf8"),
        ).map((violation) => violation.rule),
      );
      for (const rule of entry.rules) {
        expect(
          reported,
          `${rel} no longer violates "${rule}" — drop it from its entry`,
        ).toContain(rule);
      }
    }
  });

  it("no production source is skipped as a test artifact", () => {
    // The path policy exists for fixtures. Nothing under src/ may use it to
    // take itself out of scope: a `src/fixtures/**` or `src/x.test.ts` file
    // would exempt real source, so its presence fails the gate loudly.
    const exempted = listSourceFiles(SRC_ROOT)
      .map((path) => relative(SRC_ROOT, path))
      .filter((rel) => !isScannedSource(normalizeRelPath(rel)));
    expect(
      exempted,
      "source under src/ is being treated as a test artifact",
    ).toEqual([]);
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
  {
    case: "a house-style WRAPPED provider-submodule import (the specifier on its own line)",
    path: "http/example-controller.ts",
    content:
      'import {\n  githubProvider,\n} from "../providers/github-module.js";\n',
    rule: "provider submodule import",
  },
  {
    case: "provider-specific content inside the narrowly exempted docs view",
    path: "frontend/views/DocsView.tsx",
    content:
      'import { getProvider } from "../providers/registry.js";\n\nconst provider = getProvider("azure");\n',
    rule: "concrete provider lookup",
  },
];

describe("provider-agnosticism gate — negative fixtures (must be reported)", () => {
  for (const fixture of NEGATIVE_FIXTURES) {
    it(`reports ${fixture.case}`, () => {
      const violations = scanContent(fixture.path, fixture.content);
      const rules = violations.map((violation) => violation.rule);
      expect(
        violations.length,
        `${fixture.path} produced no violation for "${fixture.rule}"`,
      ).toBeGreaterThan(0);
      expect(
        new Set(rules),
        `${fixture.path} was reported under ${rules.join(", ")}`,
      ).toEqual(new Set([fixture.rule]));
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
 * Provider ids as DATA: a documentation list and a label map, read by a variable
 * key. The gate reports using a provider id to SELECT (`TABLES["azure"]`), not
 * the ids themselves being present.
 */
const PROVIDER_IDS_AS_DATA = [
  "const DOC_SECTIONS = [",
  '  { id: "azure", label: "Azure DevOps" },',
  '  { id: "github", label: "GitHub" },',
  '  { id: "jira", label: "Jira Software" },',
  "];",
  "",
  "const TITLES: Record<string, string> = {",
  '  azure: "Azure DevOps",',
  '  github: "GitHub",',
  '  jira: "Jira Software",',
  "};",
  "",
  "export function titleFor(id: string): string | undefined {",
  "  const section = DOC_SECTIONS.find((entry) => entry.id === id);",
  "  return section ? TITLES[section.id] : undefined;",
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

/**
 * The shape the docs view is exempted for: a URL slug selects which static
 * article renders, so the slug is compared with provider names. No provider is
 * looked up, no provider module is imported and no capability is dispatched —
 * which is what the entry's reason claims, and all it covers.
 */
const DOCS_VIEW_COPY_SELECTOR = [
  "const securitySection = slug as SecuritySection;",
  "",
  "function headings(section: SecuritySection) {",
  "  switch (section) {",
  '    case "azure":',
  "      return AZURE_SCOPES_ARTICLE;",
  '    case "github":',
  "      return GITHUB_PAT_ARTICLE;",
  "  }",
  "}",
  "",
  'const showAzure = securitySection === "azure";',
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
    case: "provider-specific content in a narrowly exempted content-only file",
    path: "frontend/views/DocsView.tsx",
    content: DOCS_VIEW_COPY_SELECTOR,
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
  {
    case: "provider ids held as data in a list and a label map",
    path: "frontend/components/ExampleDocsNav.tsx",
    content: PROVIDER_IDS_AS_DATA,
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
