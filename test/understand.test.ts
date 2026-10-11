// test/understand.test.ts — Unit tests for understand stage context synthesis & prompt generation.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProject } from "../src/config.js";
import type { Project, Ticket } from "../src/types.js";
import {
  buildProjectConstraints,
  checkKnowledgeNotes,
  cleanFilePath,
  existingRelevantFiles,
  extractMentionedFiles,
  inspectRootFiles,
  parseUnderstandingOutput,
} from "../src/understand.js";

describe("Understand Stage (src/understand.ts)", () => {
  const baseProject: Project = validateProject({
    id: "proj-alpha",
    name: "Alpha Project",
    repositoryPath: "/mock/repo",
    defaultBranch: "main",
    testCommand: "bun test",
  });

  const baseTicket: Ticket = {
    id: "ALPH-101",
    title: "Implement user authentication",
    description:
      "Add JWT token validation in src/auth.ts and src/middleware.ts",
    acceptanceCriteria: [
      "Valid JWT tokens allow access",
      "Expired tokens return 401",
    ],
  };

  describe("buildProjectConstraints", () => {
    it("injects all commands when testCommand, typecheckCommand, and lintCommand are present", () => {
      const project: Project = {
        ...baseProject,
        typecheckCommand: "tsc --noEmit",
        lintCommand: "biome check .",
      };

      const constraints = buildProjectConstraints(project, baseTicket);

      assert.equal(constraints.length, 5);
      assert.equal(constraints[0], "Criterion: Valid JWT tokens allow access");
      assert.equal(constraints[1], "Criterion: Expired tokens return 401");
      assert.equal(constraints[2], 'Test command must pass: "bun test"');
      assert.equal(
        constraints[3],
        'Typecheck command must pass: "tsc --noEmit"',
      );
      assert.equal(constraints[4], 'Lint command must pass: "biome check ."');
      assert.ok(!constraints.some((c) => c.includes("undefined")));
    });

    it("omits typecheck and lint constraints when absent, preventing 'undefined' strings", () => {
      const project: Project = { ...baseProject };

      const constraints = buildProjectConstraints(project, baseTicket);

      assert.equal(constraints.length, 3);
      assert.equal(constraints[0], "Criterion: Valid JWT tokens allow access");
      assert.equal(constraints[1], "Criterion: Expired tokens return 401");
      assert.equal(constraints[2], 'Test command must pass: "bun test"');
      assert.ok(!constraints.some((c) => c.includes("undefined")));
    });

    it("filters out empty or noise acceptance criteria like '-'", () => {
      const ticket: Ticket = {
        ...baseTicket,
        acceptanceCriteria: [
          "Valid criterion",
          "-",
          "  ",
          "–",
          "Another valid",
        ],
      };
      const constraints = buildProjectConstraints(baseProject, ticket);
      assert.equal(constraints[0], "Criterion: Valid criterion");
      assert.equal(constraints[1], "Criterion: Another valid");
      assert.equal(constraints[2], 'Test command must pass: "bun test"');
      assert.equal(constraints.length, 3);
    });
  });

  describe("extractMentionedFiles", () => {
    it("extracts unique file paths from ticket title, description, and plan", () => {
      const ticket: Ticket = {
        ...baseTicket,
        title: "Update config.json and src/server.ts",
        description:
          "See docs at http://example.com/spec.html and check src/auth.ts",
      };
      const plan =
        "Step 1: Modify src/auth.ts\nStep 2: Add test in test/auth.test.ts";
      const existing = ["package.json"];

      const files = extractMentionedFiles(ticket, plan, existing);

      assert.ok(files.includes("package.json"));
      assert.ok(files.includes("config.json"));
      assert.ok(files.includes("src/server.ts"));
      assert.ok(files.includes("src/auth.ts"));
      assert.ok(files.includes("test/auth.test.ts"));
      // HTTP URLs should be ignored
      assert.ok(!files.some((f) => f.startsWith("http")));
      // Deduplicated
      const authCount = files.filter((f) => f === "src/auth.ts").length;
      assert.equal(authCount, 1);
    });

    it("caps extracted files at maximum 20", () => {
      const existing: string[] = [];
      const manyFiles = Array.from(
        { length: 30 },
        (_, i) => `src/file${i}.ts`,
      ).join(" ");
      const ticket: Ticket = {
        id: "T-1",
        title: "Refactor many files",
        description: manyFiles,
        acceptanceCriteria: [],
      };

      const files = extractMentionedFiles(ticket, "", existing);
      assert.equal(files.length, 20);
    });
  });

  describe("inspectRootFiles", () => {
    it("identifies package.json, tsconfig.json, markdown files, and guideline files", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-under-"));
      await writeFile(path.join(tempDir, "package.json"), "{}");
      await writeFile(path.join(tempDir, "tsconfig.json"), "{}");
      await writeFile(path.join(tempDir, "README.md"), "# Readme");
      await writeFile(path.join(tempDir, "CLAUDE.md"), "# Guidelines");
      await writeFile(path.join(tempDir, "index.ts"), "console.log(1);");

      const { rootFiles, notes } = await inspectRootFiles(tempDir);

      assert.ok(rootFiles.includes("package.json"));
      assert.ok(rootFiles.includes("tsconfig.json"));
      assert.ok(rootFiles.includes("README.md"));
      assert.ok(rootFiles.includes("CLAUDE.md"));
      assert.ok(!rootFiles.includes("index.ts"));

      assert.ok(
        notes.includes("Repository instructions available in README.md"),
      );
      assert.ok(
        notes.includes("Repository instructions available in CLAUDE.md"),
      );

      await rm(tempDir, { recursive: true, force: true });
    });

    it("handles non-existent or unreadable worktree gracefully", async () => {
      const { rootFiles, notes } = await inspectRootFiles(
        "/nonexistent/worktree/path",
      );
      assert.deepEqual(rootFiles, []);
      assert.deepEqual(notes, []);
    });
  });

  describe("checkKnowledgeNotes", () => {
    it("returns empty array when knowledgePath is not provided", async () => {
      const notes = await checkKnowledgeNotes(undefined);
      assert.deepEqual(notes, []);
    });

    it("verifies accessible knowledge repository directory", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-kdir-"));
      const notes = await checkKnowledgeNotes(tempDir);

      assert.equal(notes.length, 1);
      assert.ok(
        notes[0]?.includes("Knowledge repository configured and verified at:"),
      );
      assert.ok(notes[0]?.includes(tempDir));

      await rm(tempDir, { recursive: true, force: true });
    });

    it("returns warning note when knowledge repository directory is inaccessible", async () => {
      const invalidPath = "/nonexistent/knowledge/repo/path";
      const notes = await checkKnowledgeNotes(invalidPath);

      assert.equal(notes.length, 1);
      assert.ok(notes[0]?.includes("is currently inaccessible"));
    });
  });

  describe("parseUnderstandingOutput", () => {
    it("reads every section, tolerating markdown and case and cleaning file references", () => {
      const sections = parseUnderstandingOutput(
        "## Relevant Files:\n- `src/auth.ts`\n- ./src/middleware.ts:12\n\n**SUMMARY:**\nAdds JWT validation to the API.\n\nEXISTING BEHAVIOR:\nTokens are never checked.\n\nConstraints:\n1. Keep the API stable\n- No new dependencies\n\nRisks:\n* Expired tokens are accepted\n",
      );

      assert.deepEqual(sections?.relevantFiles, [
        "src/auth.ts",
        "src/middleware.ts",
      ]);
      assert.equal(sections?.summary, "Adds JWT validation to the API.");
      assert.equal(sections?.existingBehavior, "Tokens are never checked.");
      assert.deepEqual(sections?.constraints, [
        "Keep the API stable",
        "No new dependencies",
      ]);
      assert.deepEqual(sections?.risks, ["Expired tokens are accepted"]);
    });

    it("returns null when the answer carries no sections at all", () => {
      assert.equal(
        parseUnderstandingOutput("I did not look at the code."),
        null,
      );
    });

    it("keeps a section's lines and ends them at the next heading", () => {
      const sections = parseUnderstandingOutput(
        "SUMMARY:\nFirst line.\nSecond line.\n\nRules:\nNot a section a run reads.\n",
      );

      assert.equal(sections?.summary, "First line.\nSecond line.");
    });
  });

  describe("cleanFilePath", () => {
    it("strips bullets, backticks, line references and trailing punctuation", () => {
      assert.equal(cleanFilePath("- `./src/a.ts`:12"), "src/a.ts");
      assert.equal(cleanFilePath("src/b.ts (line 4-6),"), "src/b.ts");
      assert.equal(cleanFilePath("2. test/c.test.ts"), "test/c.test.ts");
    });
  });

  describe("existingRelevantFiles", () => {
    it("keeps only paths that are files inside the worktree", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-files-"));
      await mkdir(path.join(tempDir, "src"), { recursive: true });
      await writeFile(path.join(tempDir, "src", "a.ts"), "export {};\n");
      await mkdir(path.join(tempDir, "src", "dir"), { recursive: true });

      const files = await existingRelevantFiles(tempDir, [
        "src/a.ts",
        "`src/a.ts`",
        "src/dir",
        "src/missing.ts",
        "../outside.ts",
        "/etc/passwd",
      ]);

      assert.deepEqual(files, ["src/a.ts"]);

      await rm(tempDir, { recursive: true, force: true });
    });
  });
});
