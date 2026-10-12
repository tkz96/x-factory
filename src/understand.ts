// src/understand.ts — Understand stage: the Builder's analysis of the ticket, and the
// typed ImplementationContext artifact it produces (#282). The Builder reads the
// repository with read-only tools and answers in named sections; this module hands
// it the facts already gathered, parses its answer, and checks the files it names
// exist. Nothing here invents an understanding: a missing answer fails the stage.

import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  ModelOutputError,
  type ReadOnlyStageRun,
  runReadOnlyStage,
} from "./agent-stage.js";
import {
  buildUnderstandingPrompt,
  renderCriterionConstraints,
} from "./prompts.js";
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
  const constraints = renderCriterionConstraints(ticket);

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

/** The sections the Builder answers the Understand prompt with (#282). */
export interface UnderstandingSections {
  relevantFiles: string[];
  summary: string;
  existingBehavior: string;
  architecturalNotes: string;
  constraints: string[];
  risks: string[];
}

/** A header line of the answer: `RELEVANT_FILES:`, `**Summary:**`, `## Risks:` … */
const SECTION_HEADER = /^([A-Za-z][A-Za-z_ ]*?):[ \t]*(.*)$/;

/** One item of a bulleted section, without its list marker. */
function sectionItems(lines: readonly string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.trim())
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * A file path as a model writes it: without bullets, backticks, a `:12` line
 * reference or trailing punctuation (#282).
 */
export function cleanFilePath(value: string): string {
  return value
    .replaceAll("`", "")
    .replace(/^[-*+\s]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\.\//, "")
    .replace(/[.,;:]+$/, "")
    .replace(/\s*\([^()]*\)$/, "")
    .replace(/:\d+(?:-\d+)?$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();
}

/**
 * The Builder's understanding as the sections the prompt asked for, or null when
 * the answer carries no sections at all (#282). Headers are matched
 * case-insensitively and with or without markdown, so `Summary:` and
 * `## SUMMARY:` are the same section.
 */
export function parseUnderstandingOutput(
  output: string,
): UnderstandingSections | null {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of output.replaceAll("**", "").split("\n")) {
    const header = raw
      .trim()
      .replace(/^#+\s*/, "")
      .match(SECTION_HEADER);
    const name = header?.[1]?.trim().toUpperCase().replaceAll(" ", "_");
    if (header?.[1] && name) {
      current = [];
      sections.set(name, current);
      const rest = (header[2] ?? "").trim();
      if (rest) current.push(rest);
      continue;
    }
    current?.push(raw.trimEnd());
  }
  if (sections.size === 0) return null;
  const block = (name: string) => (sections.get(name) ?? []).join("\n").trim();
  return {
    relevantFiles: sectionItems(sections.get("RELEVANT_FILES"))
      .map(cleanFilePath)
      .filter(Boolean),
    summary: block("SUMMARY"),
    existingBehavior: block("EXISTING_BEHAVIOR"),
    architecturalNotes: block("ARCHITECTURAL_NOTES"),
    constraints: sectionItems(sections.get("CONSTRAINTS")),
    risks: sectionItems(sections.get("RISKS")),
  };
}

/**
 * The files among `named` that exist as files in the worktree (#282). A path that
 * leaves the worktree, or that is not a file, is dropped: a stage names only files
 * a run can really read.
 */
export async function existingRelevantFiles(
  worktreePath: string,
  named: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const name of named) {
    const file = cleanFilePath(name);
    if (
      !file ||
      files.includes(file) ||
      path.isAbsolute(file) ||
      file.split("/").includes("..")
    ) {
      continue;
    }
    try {
      if ((await stat(path.join(worktreePath, file))).isFile())
        files.push(file);
    } catch {
      // Not a file in this worktree: leave it out.
    }
  }
  return files;
}

/** What the Understand stage runs with: its own inputs plus the model call (#282). */
export interface UnderstandRun extends ReadOnlyStageRun {
  ticket: Ticket;
  project: Project;
  /** The run's plan, when it has one; context for the analysis. */
  plan?: string | undefined;
}

/** What the Understand stage produced (#282). */
export interface UnderstandingResult {
  /** What later prompts read as the run's understanding. */
  context: ImplementationContext;
  /** The Builder's summary of the ticket, shown as the stage's evidence. */
  summary: string;
}

/** The Builder's own notes first, then what the repository itself said (#282). */
function mergeNotes(notes: string, repositoryNotes: readonly string[]): string {
  return [notes.trim(), ...repositoryNotes.map((note) => note.trim())]
    .filter(Boolean)
    .join("; ");
}

/**
 * Ask the Builder to understand the ticket in this repository (#282). The summary,
 * the files, the constraints and the risks are the Builder's own, checked against
 * the worktree; an answer that names no summary, or no file that exists, fails the
 * stage instead of being filled in.
 */
export async function understandRun(
  run: UnderstandRun,
): Promise<UnderstandingResult> {
  const plan = run.plan ?? "";
  const { rootFiles, notes } = await inspectRootFiles(run.worktreePath);
  const knowledgeNotes = await checkKnowledgeNotes(
    run.project.knowledgeRepositoryPath,
  );
  const repositoryNotes = [...notes, ...knowledgeNotes];
  const output = await runReadOnlyStage(
    run,
    buildUnderstandingPrompt({
      ticket: run.ticket,
      project: run.project,
      plan,
      namedFiles: extractMentionedFiles(run.ticket, plan, rootFiles),
      rootFiles,
      notes: repositoryNotes,
    }),
  );

  const sections = parseUnderstandingOutput(output);
  if (!sections?.summary) {
    throw new ModelOutputError(
      "The Builder's understanding named no summary of the ticket.",
    );
  }
  if (sections.relevantFiles.length === 0) {
    throw new ModelOutputError("The Builder's understanding named no files.");
  }
  const relevantFiles = await existingRelevantFiles(
    run.worktreePath,
    sections.relevantFiles,
  );
  if (relevantFiles.length === 0) {
    throw new ModelOutputError(
      `The Builder's understanding named no file that exists in the worktree (named: ${sections.relevantFiles.join(", ")}).`,
    );
  }

  return {
    summary: sections.summary,
    context: {
      relevantFiles,
      architecturalNotes: mergeNotes(
        sections.architecturalNotes,
        repositoryNotes,
      ),
      existingBehavior: sections.existingBehavior,
      constraints: [
        ...buildProjectConstraints(run.project, run.ticket),
        ...sections.constraints,
      ],
      risks: sections.risks,
    },
  };
}
