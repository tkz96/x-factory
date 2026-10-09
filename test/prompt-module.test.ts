// test/prompt-module.test.ts — The prompt module (#189): ticket/criteria/plan/understanding
// rendering exists in one module only, the loop/repair/review prompts render it literally,
// and the dead implementation-prompt path (builder + prompts/ directory) stays deleted.
//
// The "one module only" rule is a structural property, so it is gated the same way the
// provider-agnostic gate gates its rule: a source scan for the exact rendering markers,
// with the module that owns rendering as the single expected offender.

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildRalphPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
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

    it("renders the same ticket and acceptance criteria for the loop, repair and review prompts", () => {
      const loop = buildRalphPrompt(ticket, "1. Toggle", project);
      expect(loop).toContain(
        "## Ticket: #T-9 — Ship dark mode\nKeep the toggle on the settings page.\n### Acceptance Criteria:\n- Must not break the build\n- Must add tests",
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
        "## Ticket\n#T-9 — Ship dark mode\nDescription: Keep the toggle on the settings page.\n### Acceptance Criteria:\n1. Must not break the build\n2. Must add tests",
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
