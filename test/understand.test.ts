// test/understand.test.ts — Unit tests for understand stage context synthesis & prompt generation.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProject } from "../src/config.js";
import type { Project, Ticket } from "../src/types.js";
import {
  buildImplementationContext,
  buildImplementationPrompt,
  buildProjectConstraints,
  checkKnowledgeNotes,
  extractMentionedFiles,
  inspectRootFiles,
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

  describe("buildImplementationContext", () => {
    it("synthesizes complete ImplementationContext combining root inspection, knowledge, and constraints", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-ctx-"));
      await writeFile(path.join(tempDir, "package.json"), "{}");
      await writeFile(path.join(tempDir, "AGENTS.md"), "# Agents");

      const project: Project = {
        ...baseProject,
        knowledgeRepositoryPath: tempDir,
        typecheckCommand: "tsc --noEmit",
      };

      const context = await buildImplementationContext(
        tempDir,
        project,
        baseTicket,
        "Plan: modify src/auth.ts",
      );

      assert.ok(context.relevantFiles.includes("package.json"));
      assert.ok(context.relevantFiles.includes("src/auth.ts"));
      assert.ok(
        context.architecturalNotes.includes(
          "Repository instructions available in AGENTS.md",
        ),
      );
      assert.ok(
        context.architecturalNotes.includes(
          "Knowledge repository configured and verified",
        ),
      );
      assert.equal(context.constraints.length, 4);
      assert.ok(context.risks.length >= 3);
      assert.ok(
        context.existingBehavior.includes("Refer to worktree repository files"),
      );

      await rm(tempDir, { recursive: true, force: true });
    });

    it("falls back to standard architectural note when no instructions or knowledge repo exist", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-ctx2-"));

      const context = await buildImplementationContext(
        tempDir,
        baseProject,
        { ...baseTicket, description: undefined },
        "",
      );

      assert.equal(
        context.architecturalNotes,
        "Standard software project structure.",
      );

      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("buildImplementationPrompt", () => {
    it("builds prompt interpolating ticket, criteria, context, and accessible knowledge", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-prm-"));
      const project: Project = {
        ...baseProject,
        knowledgeRepositoryPath: tempDir,
      };

      const context = {
        relevantFiles: ["src/auth.ts"],
        architecturalNotes: "Clean repo",
        existingBehavior: "Working",
        constraints: ['Test command must pass: "bun test"'],
        risks: ["None"],
      };

      const prompt = await buildImplementationPrompt(
        project,
        baseTicket,
        "Implement auth handlers",
        context,
      );

      assert.ok(prompt.includes("#ALPH-101 — Implement user authentication"));
      assert.ok(prompt.includes("Add JWT token validation"));
      assert.ok(prompt.includes("1. Valid JWT tokens allow access"));
      assert.ok(prompt.includes("2. Expired tokens return 401"));
      assert.ok(prompt.includes("Relevant files: src/auth.ts"));
      assert.ok(
        prompt.includes('Constraints: Test command must pass: "bun test"'),
      );
      assert.ok(prompt.includes("Knowledge repository is available at:"));

      await rm(tempDir, { recursive: true, force: true });
    });

    it("handles ticket without description and without acceptance criteria", async () => {
      const simpleTicket: Ticket = {
        id: "ALPH-102",
        title: "Trivial task",
        acceptanceCriteria: [],
      };

      const context = {
        relevantFiles: [],
        architecturalNotes: "Standard",
        existingBehavior: "Working",
        constraints: [],
        risks: [],
      };

      const prompt = await buildImplementationPrompt(
        baseProject,
        simpleTicket,
        "Do it",
        context,
      );

      assert.ok(prompt.includes("#ALPH-102 — Trivial task"));
      assert.ok(!prompt.includes("Acceptance Criteria:"));
      assert.ok(prompt.includes("Relevant files: None specified"));
      assert.ok(
        prompt.includes(
          "No knowledge repository is configured for this project.",
        ),
      );
    });

    it("notes when knowledge repository is configured but inaccessible", async () => {
      const project: Project = {
        ...baseProject,
        knowledgeRepositoryPath: "/inaccessible/knowledge/repo",
      };

      const context = {
        relevantFiles: [],
        architecturalNotes: "Standard",
        existingBehavior: "Working",
        constraints: [],
        risks: [],
      };

      const prompt = await buildImplementationPrompt(
        project,
        baseTicket,
        "Plan",
        context,
      );

      assert.ok(
        prompt.includes(
          "Knowledge repository configured but directory is currently inaccessible.",
        ),
      );
    });
  });
});
