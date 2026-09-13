// src/understand.ts — Understand stage: context synthesis and typed ImplementationContext artifact generation.

import { readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import type { Project, Ticket, ImplementationContext } from "./types.js";

/**
 * Synthesize an ImplementationContext artifact for a run.
 */
async function inspectRootFiles(worktreePath: string): Promise<{
  rootFiles: string[];
  notes: string[];
}> {
  const rootFiles: string[] = [];
  const notes: string[] = [];

  try {
    const rootEntries = await readdir(worktreePath);
    for (const entry of rootEntries) {
      if (entry === "package.json" || entry === "tsconfig.json" || entry.endsWith(".md")) {
        rootFiles.push(entry);
      }
    }

    const guidelineFiles = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "README.md"];
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

function extractMentionedFiles(ticket: Ticket, plan: string, existing: string[]): string[] {
  const relevant = [...existing];
  const text = `${ticket.title} ${ticket.description || ""} ${plan}`;
  const words = text.match(/[\w\-./]+\.[a-zA-Z0-9]+/g) || [];

  for (const word of words) {
    if ((word.includes("/") || word.includes(".")) && !relevant.includes(word) && !word.startsWith("http")) {
      relevant.push(word);
    }
  }

  return relevant.slice(0, 20);
}

async function checkKnowledgeNotes(knowledgePath?: string): Promise<string[]> {
  if (!knowledgePath) return [];
  try {
    await access(knowledgePath);
    return [`Knowledge repository configured and verified at: ${knowledgePath}`];
  } catch {
    return [`Configured knowledge repository at ${knowledgePath} is currently inaccessible.`];
  }
}

function buildProjectConstraints(project: Project, ticket: Ticket): string[] {
  const constraints = ticket.acceptanceCriteria.map((ac) => `Criterion: ${ac}`);
  constraints.push(`Test command must pass: "${project.testCommand}"`);
  if (project.typecheckCommand) {
    constraints.push(`Typecheck command must pass: "${project.typecheckCommand}"`);
  }
  if (project.lintCommand) {
    constraints.push(`Lint command must pass: "${project.lintCommand}"`);
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
  plan: string
): Promise<ImplementationContext> {
  const { rootFiles, notes: rootNotes } = await inspectRootFiles(worktreePath);
  const relevantFiles = extractMentionedFiles(ticket, plan, rootFiles);
  const knowledgeNotes = await checkKnowledgeNotes(project.knowledgeRepositoryPath);
  const architecturalNotes =
    [...rootNotes, ...knowledgeNotes].join("; ") || "Standard software project structure.";

  const constraints = buildProjectConstraints(project, ticket);
  const risks = [
    "Modifying files outside the ticket scope",
    "Introducing temporary pollution or uncommitted generated files",
    "Regression in existing unit or integration tests",
  ];

  return {
    relevantFiles,
    architecturalNotes,
    existingBehavior: "Refer to worktree repository files and test suite for existing behavior.",
    constraints,
    risks,
  };
}

/**
 * Build the full implementation prompt for Pi Session A using the ImplementationContext.
 */
export async function buildImplementationPrompt(
  project: Project,
  ticket: Ticket,
  plan: string,
  context: ImplementationContext
): Promise<string> {
  const templatePath = path.join(process.cwd(), "prompts", "implementation.md");
  let template = "";
  try {
    template = await readFile(templatePath, "utf-8");
  } catch {
    // Fallback if template missing
    template = `You are implementing a production ticket.\n\n## Ticket\n{{TICKET}}\n\n## Implementation Plan\n{{PLAN}}\n\n## Knowledge Repository\n{{KNOWLEDGE_NOTE}}`;
  }

  const criteriaBlock =
    ticket.acceptanceCriteria.length > 0
      ? `\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "";

  const ticketBlock = `#${ticket.id} — ${ticket.title}${ticket.description ? `\n\n${ticket.description}` : ""}${criteriaBlock}`;
  template = template.replace("{{TICKET}}", ticketBlock);

  // Add context to plan
  const contextBlock = `\n\n### Implementation Context:\n- Relevant files: ${context.relevantFiles.join(", ") || "None specified"}\n- Constraints: ${context.constraints.join("; ")}\n- Architectural notes: ${context.architecturalNotes}`;
  template = template.replace("{{PLAN}}", `${plan}${contextBlock}`);

  // Knowledge note
  let knowledgeNote = "No knowledge repository is configured for this project.";
  if (project.knowledgeRepositoryPath) {
    try {
      await access(project.knowledgeRepositoryPath);
      knowledgeNote = `Knowledge repository is available at: ${project.knowledgeRepositoryPath}\nConsult it for patterns, architecture, and standards.`;
    } catch {
      knowledgeNote = "Knowledge repository configured but directory is currently inaccessible.";
    }
  }
  template = template.replace("{{KNOWLEDGE_NOTE}}", knowledgeNote);

  return template;
}
