// src/understand.ts — Understand stage: context synthesis and typed ImplementationContext artifact generation.

import { access, readdir } from "node:fs/promises";
import type { ImplementationContext, Project, Ticket } from "./types.js";

/**
 * Synthesize an ImplementationContext artifact for a run.
 */
export async function inspectRootFiles(worktreePath: string): Promise<{
  rootFiles: string[];
  notes: string[];
}> {
  const rootFiles: string[] = [];
  const notes: string[] = [];

  try {
    const rootEntries = await readdir(worktreePath);
    for (const entry of rootEntries) {
      if (
        entry === "package.json" ||
        entry === "tsconfig.json" ||
        entry.endsWith(".md")
      ) {
        rootFiles.push(entry);
      }
    }

    const guidelineFiles = [
      "AGENTS.md",
      "CLAUDE.md",
      "CONTRIBUTING.md",
      "README.md",
    ];
    for (const gf of guidelineFiles) {
      if (rootEntries.includes(gf)) {
        notes.push(`Repository instructions available in ${gf}`);
      }
    }
  } catch {
    // If readdir fails, proceed gracefully
  }

  return { rootFiles, notes };
}

export function extractMentionedFiles(
  ticket: Ticket,
  plan: string,
  existing: string[],
): string[] {
  const relevant = [...existing];
  const text = `${ticket.title} ${ticket.description || ""} ${plan}`;
  const words = text.match(/[\w\-./]+\.[a-zA-Z0-9]+/g) || [];

  for (const word of words) {
    if (
      (word.includes("/") || word.includes(".")) &&
      !relevant.includes(word) &&
      !word.startsWith("http")
    ) {
      relevant.push(word);
    }
  }

  return relevant.slice(0, 20);
}

export async function checkKnowledgeNotes(
  knowledgePath?: string,
): Promise<string[]> {
  if (!knowledgePath) return [];
  try {
    await access(knowledgePath);
    return [
      `Knowledge repository configured and verified at: ${knowledgePath}`,
    ];
  } catch {
    return [
      `Configured knowledge repository at ${knowledgePath} is currently inaccessible.`,
    ];
  }
}

export function buildProjectConstraints(
  project: Project,
  ticket: Ticket,
): string[] {
  const constraints = (ticket.acceptanceCriteria || [])
    .map((ac) => ac.trim())
    .filter((ac) => ac && ac !== "-" && ac !== "–" && ac !== "—")
    .map((ac) => `Criterion: ${ac}`);

  if (project.testCommand?.trim()) {
    constraints.push(`Test command must pass: "${project.testCommand.trim()}"`);
  }
  if (project.typecheckCommand?.trim()) {
    constraints.push(
      `Typecheck command must pass: "${project.typecheckCommand.trim()}"`,
    );
  }
  if (project.lintCommand?.trim()) {
    constraints.push(`Lint command must pass: "${project.lintCommand.trim()}"`);
  }
  return constraints;
}

/**
 * Synthesize an ImplementationContext artifact for a run.
 */
export async function buildImplementationContext(
  worktreePath: string,
  project: Project,
  ticket: Ticket,
  plan: string,
): Promise<ImplementationContext> {
  const { rootFiles, notes: rootNotes } = await inspectRootFiles(worktreePath);
  const relevantFiles = extractMentionedFiles(ticket, plan, rootFiles);
  const knowledgeNotes = await checkKnowledgeNotes(
    project.knowledgeRepositoryPath,
  );
  const architecturalNotes =
    [...rootNotes, ...knowledgeNotes].join("; ") ||
    "Standard software project structure.";

  const constraints = buildProjectConstraints(project, ticket);
  const risks = [
    "Modifying files outside the ticket scope",
    "Introducing temporary pollution or uncommitted generated files",
    "Regression in existing unit or integration tests",
  ];

  return {
    relevantFiles,
    architecturalNotes,
    existingBehavior:
      "Refer to worktree repository files and test suite for existing behavior.",
    constraints,
    risks,
  };
}
