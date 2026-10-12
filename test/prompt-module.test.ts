// test/prompt-module.test.ts — The prompt module (#189): ticket/criteria/plan/understanding
// rendering exists in one module only, the loop/repair/review prompts render it literally,
// and the dead implementation-prompt path (builder + prompts/ directory) stays deleted.
//
// "One module only" is gated two ways. The exact rendering markers must all live in
// src/prompts.ts, and a property-access scan — not a variable-name scan — must find no
// ticket rendering anywhere else in src/ except the two allowlisted entries, each with
// the reason it is allowed. The scan matches `.acceptanceCriteria` interpolations and
// heading-form `.title`/`.id` interpolations, so `run.ticket.id`, `t.title`, a renamed
// receiver or a `": "` separator cannot slip past it the way `ticket.` could.

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildPlanPrompt,
  buildRalphPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  buildUnderstandingPrompt,
} from "../src/prompts.js";
import type {
  ImplementationContext,
  Project,
  Ticket,
} from "../src/shared/types.js";
import type { VerificationResult } from "../src/types.js";

const REPO_ROOT = join(import.meta.dir, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

/**
 * Source markers of ticket / acceptance-criteria rendering: the criteria block
 * inside a template literal, the em-dash ticket heading, and the ticket.md
 * heading. Wherever they appear, they must all appear together in the one
 * module that owns prompt rendering.
 */
const RENDER_MARKERS: RegExp[] = [
  // criteria formatted into list lines (bullet or numbered) inside a template literal
  /ticket\.acceptanceCriteria\.map\([^)]*\) => `/,
  // the em-dash ticket heading
  /\$\{ticket\.id\} —/,
  // the ticket.md heading
  /# Ticket \$\{ticket\.id\}/,
];

/**
 * The property-access rendering rules: outside src/prompts.ts, a template literal or
 * string concatenation may not interpolate `.acceptanceCriteria`, and may not start a
 * markdown heading with a ticket's `.title`/`.id`. These match property access, not
 * variable names, so `run.ticket.id`, `t.title`, a renamed receiver and a `": "`
 * separator are all in scope of the gate.
 */
const RENDER_RULES: { name: string; source: string }[] = [
  {
    name: "interpolates .acceptanceCriteria",
    source:
      "\\$\\{[^}]*\\.acceptanceCriteria\\b|[\"'`]\\s*\\+\\s*[^;]*\\.acceptanceCriteria\\b|\\.acceptanceCriteria\\b[^;'\"`]*\\+\\s*[\"'`]",
  },
  {
    name: "heading-form .title/.id",
    source:
      "(?:`|\\n)\\s*#\\s*[^`]*?\\$\\{[^}]*\\.(?:title|id)\\b|[\"'\\n]\\s*#\\s*[^\"'`]*?\\+\\s*[^;]*\\.(?:title|id)\\b",
  },
];

/**
 * The only legitimate ticket rendering outside src/prompts.ts. Each entry carries the
 * reason it exists, and the gate fails if an entry stops matching, so this list cannot
 * quietly grow stale or oversized.
 */
const ALLOWLIST: {
  reason: string;
  allows: (file: string, source: string, index: number) => boolean;
}[] = [
  {
    reason: "UI display in src/frontend/",
    allows: (file) => file.startsWith("src/frontend/"),
  },
  {
    reason: "task-checklist parsing in formatTasksMarkdown",
    allows: (file, source, index) => {
      if (file !== "src/attempt-loop.ts") return false;
      const span = functionSpan(source, "formatTasksMarkdown");
      return span !== null && index >= span[0] && index <= span[1];
    },
  },
];

/** The character span of one top-level function, ending at its column-0 closing brace. */
function functionSpan(source: string, name: string): [number, number] | null {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const end = source.indexOf("\n}\n", start);
  return [start, end === -1 ? source.length : end + 2];
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const ticket: Ticket = {
  id: "T-9",
  title: "Ship dark mode",
  description: "Keep the toggle on the settings page.",
  acceptanceCriteria: ["Must not break the build", "Must add tests"],
};

const project: Project = {
  id: "p1",
  name: "P1",
  workspacePath: "/w",
  repositoryPath: "/r",
  defaultBranch: "main",
  testCommand: "bun test",
  repositories: [],
  issueTracker: { provider: "github" },
};

const verification: VerificationResult = {
  passed: false,
  repairAttempt: 1,
  tests: {
    command: "bun test",
    exitCode: 1,
    stdout: "",
    stderr: "FAIL src/theme.test.ts",
    passed: false,
    durationMs: 10,
  },
  diff: "- old\n+ new",
  filesChanged: ["src/theme.ts"],
  hasPollution: false,
  summary: "Tests failed (exit 1)",
};

const understanding: ImplementationContext = {
  relevantFiles: ["src/auth.ts"],
  architecturalNotes: "Sessions are stored in src/store.ts.",
  existingBehavior: "Login issues a signed cookie.",
  constraints: ['Test command must pass: "bun test"'],
  risks: ["Editing src/auth.ts breaks existing sessions"],
};

describe("Prompt module (src/prompts.ts)", () => {
  describe("ticket/criteria rendering exists in one module only", () => {
    it("holds every rendering marker in src/prompts.ts and nowhere else in src/", () => {
      const offenders = sourceFiles(SRC_ROOT)
        .filter((file) => {
          const source = readFileSync(file, "utf-8");
          return RENDER_MARKERS.some((marker) => marker.test(source));
        })
        .map((file) => relative(REPO_ROOT, file))
        .sort();

      expect(offenders).toEqual(["src/prompts.ts"]);
    });

    it("flags property-access ticket rendering outside the module, allowlisting only UI display and checklist parsing", () => {
      const offenders: string[] = [];
      const unusedReasons = new Set(ALLOWLIST.map((entry) => entry.reason));

      for (const file of sourceFiles(SRC_ROOT)) {
        const rel = relative(REPO_ROOT, file);
        if (rel === "src/prompts.ts") continue; // the module that owns rendering
        const source = readFileSync(file, "utf-8");
        for (const rule of RENDER_RULES) {
          for (const match of source.matchAll(new RegExp(rule.source, "g"))) {
            const index = match.index ?? 0;
            const allowed = ALLOWLIST.find((entry) =>
              entry.allows(rel, source, index),
            );
            if (allowed) {
              unusedReasons.delete(allowed.reason);
              continue;
            }
            offenders.push(`${rel}:${lineOf(source, index)} (${rule.name})`);
          }
        }
      }

      expect(offenders).toEqual([]);
      expect([...unusedReasons]).toEqual([]);
    });

    it("matches property access, so renamed receivers and separators cannot evade it", () => {
      const criteria = new RegExp(RENDER_RULES[0]?.source ?? "$^");
      const heading = new RegExp(RENDER_RULES[1]?.source ?? "$^");

      // Synthetic sources written as templates (escaped ${ / `) so the snippets
      // themselves do not read as template placeholders to the linter.
      const criteriaSnippet = `plan += \`\n- \${run.ticket.acceptanceCriteria}\`;`;
      const planHeadingSnippet = `const p = \`# Execution Plan for #\${run.ticket.id}: \${t.title}\`;`;
      const taskHeadingSnippet = `const h = \`## \${t.title}\`;`;
      const chatSnippet = `const s = \`Starting run for #\${run.ticket.id}\`;`;

      expect(criteria.test(criteriaSnippet)).toBe(true);
      expect(heading.test(planHeadingSnippet)).toBe(true);
      expect(heading.test(taskHeadingSnippet)).toBe(true);
      expect(heading.test(chatSnippet)).toBe(false);
    });

    it("renders the same ticket and acceptance criteria for the loop, repair and review prompts", () => {
      const loop = buildRalphPrompt(ticket, "1. Toggle", project);
      expect(loop).toContain(
        "## Ticket: #T-9 — Ship dark mode\nKeep the toggle on the settings page.\n\n### Acceptance Criteria:\n- Must not break the build\n- Must add tests",
      );

      const repair = buildRepairPrompt(ticket, "1. Toggle", verification, 1);
      expect(repair).toContain(
        "## Ticket\n#T-9 — Ship dark mode\n### Acceptance Criteria:\n1. Must not break the build\n2. Must add tests",
      );

      const review = buildReviewPrompt(
        ticket,
        "1. Toggle",
        "diff --git a/src/theme.ts",
        verification,
      );
      expect(review).toContain(
        "## Ticket\n#T-9 — Ship dark mode\nDescription: Keep the toggle on the settings page.\n\n### Acceptance Criteria:\n1. Must not break the build\n2. Must add tests",
      );
    });

    it("renders a blank line before the criteria when the ticket has no description", () => {
      const bare: Ticket = { ...ticket, description: "" };

      expect(buildRalphPrompt(bare, "1. Toggle", project)).toContain(
        "## Ticket: #T-9 — Ship dark mode\n\n### Acceptance Criteria:\n- Must not break the build",
      );

      expect(
        buildReviewPrompt(
          bare,
          "1. Toggle",
          "diff --git a/src/theme.ts",
          verification,
        ),
      ).toContain(
        "## Ticket\n#T-9 — Ship dark mode\n\n### Acceptance Criteria:\n1. Must not break the build",
      );
    });

    it("renders the run's understanding context into the loop, repair and review prompts", () => {
      const expected =
        "## Codebase Understanding\n" +
        "\nRelevant files: src/auth.ts\n" +
        "Existing behavior: Login issues a signed cookie.\n" +
        "Architectural notes: Sessions are stored in src/store.ts.\n" +
        '\nConstraints:\n- Test command must pass: "bun test"\n' +
        "\nRisks:\n- Editing src/auth.ts breaks existing sessions";

      expect(
        buildRalphPrompt(ticket, "1. Toggle", project, understanding),
      ).toContain(expected);
      expect(
        buildRepairPrompt(ticket, "1. Toggle", verification, 1, understanding),
      ).toContain(expected);
      expect(
        buildReviewPrompt(
          ticket,
          "1. Toggle",
          "diff --git a/src/theme.ts",
          verification,
          understanding,
        ),
      ).toContain(expected);
    });

    it("omits the understanding section when the run has none", () => {
      expect(buildRalphPrompt(ticket, "1. Toggle", project)).not.toContain(
        "## Codebase Understanding",
      );
    });
  });

  describe("the Understand and Plan prompts (#282)", () => {
    it("asks the Builder to understand the ticket in named sections", () => {
      const prompt = buildUnderstandingPrompt({
        ticket,
        project,
        plan: "1. Toggle",
        namedFiles: ["src/theme.ts"],
        rootFiles: ["package.json"],
        notes: ["Repository instructions available in AGENTS.md"],
      });

      expect(prompt).toContain("#T-9 — Ship dark mode");
      expect(prompt).toContain("- Must not break the build");
      expect(prompt).toContain("- Must add tests");
      expect(prompt).toContain("Test Command: `bun test`");
      expect(prompt).toContain("Root files: package.json");
      expect(prompt).toContain("Paths the ticket and plan name: src/theme.ts");
      expect(prompt).toContain(
        "Repository instructions available in AGENTS.md",
      );
      expect(prompt).toContain("## Plan\n1. Toggle");
      expect(prompt).toContain("RELEVANT_FILES:");
      expect(prompt).toContain("SUMMARY:");
      expect(prompt).toContain("Name only files that exist in this repository");
    });

    it("asks the Builder for a plan naming files and tests, with the plan so far", () => {
      const prompt = buildPlanPrompt({
        ticket,
        project,
        draft: "1. Toggle",
        understanding,
      });

      expect(prompt).toContain("# Execution Plan for #T-9: Ship dark mode");
      expect(prompt).toContain("## Codebase Understanding");
      expect(prompt).toContain("Relevant files: src/auth.ts");
      expect(prompt).toContain("## Plan so far\n1. Toggle");
      expect(prompt).toContain(
        "Every task must name the repository-relative file",
      );
      expect(prompt).toContain("Answer with the plan only");
    });

    it("leaves the optional blocks out when the run has none of them", () => {
      const bareProject: Project = { ...project, testCommand: "" };
      const understandingPrompt = buildUnderstandingPrompt({
        ticket,
        project: bareProject,
      });
      expect(understandingPrompt).not.toContain("## Repository");
      expect(understandingPrompt).not.toContain("## Plan");
      expect(understandingPrompt).not.toContain("### Verification Commands:");

      const planPrompt = buildPlanPrompt({ ticket, project: bareProject });
      expect(planPrompt).not.toContain("## Plan so far");
      expect(planPrompt).not.toContain("## Codebase Understanding");
      expect(planPrompt).not.toContain("### Verification Commands:");
    });
  });

  describe("the coding loop prompt without a test command", () => {
    it("never names a test command the project does not have", () => {
      const bareProject: Project = { ...project, testCommand: "" };
      const loop = buildRalphPrompt(ticket, "1. Toggle", bareProject);

      expect(loop).not.toContain("bun test");
      expect(loop).toContain(
        "- Test Command: none. This project has no test command.",
      );
      expect(loop).not.toContain("the project's test command (``)");
    });

    it("names the project's own test command when it has one", () => {
      const loop = buildRalphPrompt(ticket, "1. Toggle", {
        ...project,
        testCommand: "npm test",
      });
      expect(loop).toContain("- Test Command: `npm test`");
      expect(loop).toContain("the project's test command (`npm test`)");
    });
  });

  describe("the dead implementation-prompt path stays deleted", () => {
    it("has no reader of a repository-root prompts/ directory anywhere in src/", () => {
      const readers = sourceFiles(SRC_ROOT).filter((file) =>
        /["'`]prompts["'`]/.test(readFileSync(file, "utf-8")),
      );

      expect(readers).toEqual([]);
    });

    it("has no prompts/ directory at the repository root", () => {
      expect(existsSync(join(REPO_ROOT, "prompts"))).toBe(false);
    });
  });
});
