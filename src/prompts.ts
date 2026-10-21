// src/prompts.ts — The prompt module (#189): one renderer for the ticket, acceptance criteria,
// plan and understanding context. The loop (Ralph), repair and review prompts are built here,
// and the ticket artifact and PR body render their ticket/criteria blocks through the same
// functions, so ticket/criteria formatting exists in this module only.

import type {
  ImplementationContext,
  Project,
  Ticket,
  VerificationResult,
} from "./shared/types.js";
import { MAX_REPAIR_ATTEMPTS } from "./verification.js";

/**
 * The em-dash ticket heading shared by every prompt. Pass `hash: false` for the
 * bare `ID — Title` line used by the PR body, or `separator` to join id and title
 * with something other than ` — ` (the execution plan heading uses `": "`).
 */
export function renderTicketHeading(
  ticket: Ticket,
  options?: { hash?: boolean; separator?: string },
): string {
  const heading = `${ticket.id}${options?.separator ?? " — "}${ticket.title}`;
  if (options?.hash === false) return heading;
  return `#${heading}`;
}

/**
 * The acceptance-criteria list: `- item` bullets by default, `1. item` lines when
 * numbered. An empty ticket renders `fallback` ("" when none is given).
 */
export function renderAcceptanceCriteria(
  ticket: Ticket,
  options?: { numbered?: boolean; fallback?: string },
): string {
  if (!ticket.acceptanceCriteria?.length) return options?.fallback ?? "";
  if (options?.numbered) {
    return ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }
  return ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
}

/** The `ticket.md` artifact body, rendered by the same module as the prompts. */
export function renderTicketDoc(ticket: Ticket): string {
  return `# Ticket ${ticket.id}: ${ticket.title}\n\n${ticket.description || ""}\n\n### Acceptance Criteria:\n${renderAcceptanceCriteria(ticket)}`;
}

/**
 * Each acceptance criterion as an understanding-stage constraint line. The criteria
 * text that reaches the prompt's Constraints block is formatted here, so this is
 * prompt rendering too; blank and dash-only criteria are dropped and the surviving
 * text is unchanged (`Criterion: <criterion>`).
 */
export function renderCriterionConstraints(ticket: Ticket): string[] {
  return (ticket.acceptanceCriteria || [])
    .map((ac) => ac.trim())
    .filter((ac) => ac && ac !== "-" && ac !== "–" && ac !== "—")
    .map((ac) => `Criterion: ${ac}`);
}

/**
 * What the understand stage learned, rendered as a prompt section. Returns "" when
 * the run has no understanding context, so prompts without it are unchanged.
 */
function renderUnderstanding(
  context: ImplementationContext | null | undefined,
): string {
  if (!context) return "";
  const lines = [
    "## Codebase Understanding",
    "",
    `Relevant files: ${context.relevantFiles.join(", ") || "None identified"}`,
    `Existing behavior: ${context.existingBehavior}`,
    `Architectural notes: ${context.architecturalNotes}`,
  ];
  if (context.constraints.length > 0) {
    lines.push("", "Constraints:", ...context.constraints.map((c) => `- ${c}`));
  }
  if (context.risks.length > 0) {
    lines.push("", "Risks:", ...context.risks.map((r) => `- ${r}`));
  }
  return `${lines.join("\n")}\n\n`;
}

/**
 * Builds .agent/PROMPT.md injecting Matt Pocock's TDD & implementation protocols.
 */
export function buildRalphPrompt(
  ticket: Ticket,
  plan: string,
  project: Project,
  understanding?: ImplementationContext | null,
): string {
  const acList = renderAcceptanceCriteria(ticket, {
    fallback:
      "- Ensure all tests pass and implementation meets ticket description.",
  });
  const understandingBlock = renderUnderstanding(understanding);

  // Never invent a test command the project does not have.
  const testCmd = project.testCommand?.trim();
  const testCommandLine = testCmd
    ? `- Test Command: \`${testCmd}\``
    : "- Test Command: none. This project has no test command.";
  const runTestsStep = testCmd
    ? `Run the test suite using the project's test command (\`${testCmd}\`).`
    : "Run the test with the repository's own test runner, if it has one.";
  const typecheckCmd = project.typecheckCommand
    ? `- Typecheck Command: \`${project.typecheckCommand}\``
    : "";
  const lintCmd = project.lintCommand
    ? `- Lint Command: \`${project.lintCommand}\``
    : "";

  return `# Ralph Loop Task Execution Protocol (Matt Pocock TDD Protocol)

## Ticket: ${renderTicketHeading(ticket)}
${ticket.description ? `${ticket.description}\n` : ""}
### Acceptance Criteria:
${acList}

### Verification Commands:
${testCommandLine}
${typecheckCmd}
${lintCmd}

---

## Approved Execution Plan:
${plan}

${understandingBlock}---

## Autonomous Execution Rules

You are the autonomous coding agent (Pi) executing tasks iteratively inside Ralph Loop.
Follow these rules strictly:

### 1. Test-Driven Development (TDD) Loop (Red-Green-Refactor)
For EVERY task in \`.agent/tasks.md\`:
1. **Red**: Write a failing test first that specifies the expected behavior.
   - ${runTestsStep}
   - Verify that the test fails for the expected reason.
2. **Green**: Write the minimal amount of implementation code to make the test pass.
   - Do NOT add unnecessary abstractions or speculative code.
   - Run the test suite and verify that the test passes.
3. **Refactor**: Clean up the code.
   - Run typecheck and lint to ensure code quality.
   - Ensure all existing tests still pass.

### 2. One Task Per Iteration
- Open \`.agent/tasks.md\`.
- Find the first unchecked \`- [ ]\` task or step.
- Implement ONLY that task. Do not jump ahead or combine tasks.
- When all steps for that task are verified and all tests pass, update \`.agent/tasks.md\` by checking off that task: change \`- [ ]\` to \`- [x]\`.

### 3. Invariants
- Never delete or disable existing tests to make a test pass.
- All commands (test, typecheck, lint) must exit cleanly with code 0 before completing a task.
- When all tasks in \`.agent/tasks.md\` are marked \`[x]\`, conclude your work.
`;
}

/**
 * Formats a tightly scoped repair prompt for Pi when deterministic verification fails.
 */
export function buildRepairPrompt(
  ticket: Ticket,
  plan: string,
  verification: VerificationResult,
  attempt: number,
  understanding?: ImplementationContext | null,
): string {
  const failedParts: string[] = [];

  if (!verification.tests.passed && !verification.tests.skipped) {
    failedParts.push(
      `### Test Failure (${verification.tests.command}):\n\`\`\`\n${verification.tests.stderr || verification.tests.stdout}\n\`\`\``,
    );
  }
  if (verification.typecheck && !verification.typecheck.passed) {
    failedParts.push(
      `### Typecheck Failure (${verification.typecheck.command}):\n\`\`\`\n${verification.typecheck.stderr || verification.typecheck.stdout}\n\`\`\``,
    );
  }
  if (verification.lint && !verification.lint.passed) {
    failedParts.push(
      `### Lint Failure (${verification.lint.command}):\n\`\`\`\n${verification.lint.stderr || verification.lint.stdout}\n\`\`\``,
    );
  }
  if (verification.hasPollution && verification.pollutionDetails) {
    failedParts.push(
      `### Pollution Detected:\n${verification.pollutionDetails.join("\n")}`,
    );
  }
  if (verification.filesChanged.length === 0) {
    failedParts.push(
      `### No Changes:\nNo code changes were made to address the ticket.`,
    );
  }

  const criteria = renderAcceptanceCriteria(ticket, { numbered: true });
  const criteriaBlock = criteria
    ? `\n### Acceptance Criteria:\n${criteria}`
    : "";
  const understandingBlock = renderUnderstanding(understanding);

  return `Deterministic verification checks failed on attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}.

## Ticket
${renderTicketHeading(ticket)}${criteriaBlock}

## Implementation Plan
${plan}

${understandingBlock}## Verification Failures
${failedParts.join("\n\n")}

## Current Changed Files
${verification.filesChanged.join("\n") || "None"}

## Repair Instructions
1. Fix ONLY the issues required to make verification checks and tests pass.
2. Do NOT rewrite unrelated code or introduce speculative changes.
3. Clean up any temporary or debug files.
4. Ensure the implementation completely satisfies the ticket and acceptance criteria.`;
}

export function buildReviewPrompt(
  ticket: Ticket,
  plan: string,
  diff: string,
  verification: VerificationResult,
  understanding?: ImplementationContext | null,
): string {
  const criteriaList = renderAcceptanceCriteria(ticket, {
    numbered: true,
    fallback:
      "1. The implementation must fulfill the ticket title and description without regressions.",
  });
  const understandingBlock = renderUnderstanding(understanding);

  return `You are an independent, read-only code reviewer evaluating a completed implementation.
You have access to read, grep, find, and ls tools. You CANNOT modify code or run commands.

## Ticket
${renderTicketHeading(ticket)}
${ticket.description ? `Description: ${ticket.description}\n` : ""}
### Acceptance Criteria:
${criteriaList}

## Implementation Plan
${plan}

${understandingBlock}## Verification Results
${verification.summary}
Changed files: ${verification.filesChanged.join(", ") || "None"}

## Git Diff
\`\`\`diff
${diff.slice(0, 30_000)}
\`\`\`

## Your Task
1. Inspect the diff and repository files to verify correctness.
2. Check whether EVERY acceptance criterion is satisfied.
3. Check for unintended modifications, style discrepancies, or bugs.
4. Report your assessment.

Format your response clearly. Write exactly one line for each numbered criterion.

CRITERIA_CHECK:
- [PASS|FAIL] <n>. <criterion text> — <evidence>

FINDINGS:
- [INFO|WARNING|ERROR] <finding description> (file:path, line:N if applicable)

VERDICT:
[PASSED|FAILED] - <concise summary>`;
}

/**
 * The project's verification commands as prompt lines (#282), or "" when the
 * project has none set. The Ralph prompt renders its own command lines; this is
 * the shape the Understand and Plan prompts share.
 */
function renderVerificationCommands(project: Project): string {
  const lines: string[] = [];
  if (project.testCommand?.trim()) {
    lines.push(`- Test Command: \`${project.testCommand.trim()}\``);
  }
  if (project.typecheckCommand?.trim()) {
    lines.push(`- Typecheck Command: \`${project.typecheckCommand.trim()}\``);
  }
  if (project.lintCommand?.trim()) {
    lines.push(`- Lint Command: \`${project.lintCommand.trim()}\``);
  }
  return lines.join("\n");
}

/** The "## Verification Commands" block, or "" when the project sets none. */
function renderVerificationBlock(project: Project): string {
  const commands = renderVerificationCommands(project);
  return commands ? `\n### Verification Commands:\n${commands}\n` : "";
}

/** What the Understand stage asks the Builder, and the facts it hands it (#282). */
export interface UnderstandingPromptInput {
  ticket: Ticket;
  project: Project;
  /** The run's plan, when it already has one. */
  plan?: string | undefined;
  /** Paths the ticket and plan name; a hint the Builder must confirm itself. */
  namedFiles?: readonly string[] | undefined;
  /** Root files found before the call. */
  rootFiles?: readonly string[] | undefined;
  /** Repository notes found before the call: instructions, knowledge repo. */
  notes?: readonly string[] | undefined;
}

/**
 * The Understand prompt (#282): the Builder reads the repository with read-only
 * tools and answers in named sections, so the stage parses a summary and the
 * files the ticket is about. It never asks for a generic description of a
 * project: every section is about this ticket in this repository.
 */
export function buildUnderstandingPrompt(
  input: UnderstandingPromptInput,
): string {
  const { ticket, project, plan, namedFiles, rootFiles, notes } = input;
  const criteria = renderAcceptanceCriteria(ticket, {
    fallback:
      "1. The implementation must fulfill the ticket title and description without regressions.",
  });
  const repository = [
    rootFiles?.length ? `Root files: ${rootFiles.join(", ")}` : "",
    namedFiles?.length
      ? `Paths the ticket and plan name: ${namedFiles.join(", ")}`
      : "",
    ...(notes ?? []),
  ].filter(Boolean);
  const repositoryBlock =
    repository.length > 0 ? `## Repository\n${repository.join("\n")}\n\n` : "";
  const planBlock = plan?.trim() ? `## Plan\n${plan.trim()}\n\n` : "";

  return `You are analysing a repository for an upcoming ticket, before any code is written.
You have read-only tools: read, grep, find, ls. You cannot change a file or run a command.

## Ticket
${renderTicketHeading(ticket)}
${ticket.description ? `Description: ${ticket.description}\n` : ""}
### Acceptance Criteria:
${criteria}
${renderVerificationBlock(project)}
${repositoryBlock}${planBlock}## Your Task
Inspect the repository with your tools, then answer with exactly these sections, in this order, and nothing else:

RELEVANT_FILES:
- <repository-relative path of a file that exists today and this ticket concerns>

SUMMARY:
<one paragraph: what the ticket asks for, and how it fits this repository>

CHANGE_REQUIRED:
<yes or no on the first line, then one or two sentences on the next lines: why a change is, or is not, required>

EXISTING_BEHAVIOR:
<what those files do today, and what the change must not break>

ARCHITECTURAL_NOTES:
<the conventions, modules and boundaries the change must follow>

CONSTRAINTS:
- <a constraint the implementation must respect>

CONFLICTS:
- <an acceptance criterion that contradicts another criterion, or the code as it is, and what they disagree about>

RISKS:
- <a risk or edge case the implementation must handle>

Rules:
- Name only files that exist in this repository today; never a path you have not read with your tools.
- The RELEVANT_FILES lines are the files the summary is about.
- Answer CHANGE_REQUIRED no only when the repository already does what the ticket asks; name the file and test that prove it.
- CONFLICTS lists only real contradictions between the criteria above, or between a criterion and the code. Leave it empty when the criteria agree. Never reword, drop or pick a side for a criterion: the operator decides.
- One item per \`- \` line, no code fences, and no text outside the sections.`;
}

/** What the Plan stage asks the Builder, plus the plan the run already has (#282). */
export interface PlanPromptInput {
  ticket: Ticket;
  project: Project;
  /** The plan the run already has: the operator's draft, or the last plan plus feedback. */
  draft?: string | undefined;
  /** What the Understand stage learned, when the run has it. */
  understanding?: ImplementationContext | null | undefined;
}

/**
 * The Plan prompt (#282): the Builder turns the ticket, the run's own draft plan
 * and what Understand learned into concrete steps that name the files and tests
 * they touch. The plan it answers with is what the run shows for approval.
 */
export function buildPlanPrompt(input: PlanPromptInput): string {
  const { ticket, project, draft, understanding } = input;
  const criteria = renderAcceptanceCriteria(ticket, {
    fallback:
      "1. The implementation must fulfill the ticket title and description without regressions.",
  });
  const understandingBlock = renderUnderstanding(understanding);
  const conflictBlock = understanding?.conflicts?.length
    ? `## Open criterion conflicts\nThe operator has not decided these. Keep every criterion they name exactly as written.\n${understanding.conflicts.map((c) => `- ${c}`).join("\n")}\n\n`
    : "";
  const noChangeBlock =
    understanding?.changeRequired === false
      ? `## No change required\nThe understanding found that no change is required: ${understanding.changeReason?.trim() || "the repository already does what the ticket asks"}\nIf the run continues anyway, do not invent work. Plan no code change, and name the existing file and test that already prove the criteria.\n\n`
      : "";
  const draftBlock = draft?.trim() ? `## Plan so far\n${draft.trim()}\n\n` : "";

  return `You are writing the implementation plan for a ticket, before any code is written.
You have read-only tools: read, grep, find, ls. You cannot change a file or run a command.

## Ticket
${renderTicketHeading(ticket)}
${ticket.description ? `Description: ${ticket.description}\n` : ""}
### Acceptance Criteria:
${criteria}
${renderVerificationBlock(project)}
${understandingBlock}${noChangeBlock}${conflictBlock}${draftBlock}## Your Task
Inspect the repository with your tools, then write the plan as Markdown.
Start with \`# Execution Plan for ${renderTicketHeading(ticket, { separator: ": " })}\`.
Every task must name the repository-relative file it changes and the test file it adds or updates, each in \`backticks\`.
Order the tasks so a failing test comes first, and keep the verification commands above as the last steps.

Answer with the plan only: no preamble, no commentary, no code fences.

Rules:
- Name real files and real tests; never a path you have not read with your tools.
- Keep the intent of the plan so far, and make every step concrete.
- Name the test file each change is proven by; a step without a test file is incomplete.
- Never change, drop or reinterpret an acceptance criterion. Copy each criterion exactly as it is written, even when it conflicts with another criterion or with the code.
- If criteria conflict, say so in a "Needs your decision" section of the plan, name the criteria, and leave them unchanged. Do not pick a reading yourself.`;
}

export interface ChatPromptInput {
  ticket: Ticket;
  /** The run's status: which approval gate the operator is at. */
  phase: "understanding" | "plan" | "review";
  plan?: string | undefined;
  understanding?: ImplementationContext | null | undefined;
}

const CHAT_PHASE_LABELS: Readonly<Record<ChatPromptInput["phase"], string>> = {
  understanding:
    "the understanding checkpoint: you have analysed the ticket and are waiting for the operator to approve your understanding",
  plan: "the plan checkpoint: you have written the implementation plan and are waiting for the operator to approve it",
  review:
    "the review checkpoint: you have made the change and it is waiting for the operator's review",
};

/**
 * The run chat system prompt: the Builder, who is doing the work on this run,
 * answering the operator who reviews it at an approval gate. The operator asks;
 * the Builder answers about its own understanding, plan and change.
 */
export function buildChatSystemPrompt(input: ChatPromptInput): string {
  const { ticket, phase, plan, understanding } = input;
  const criteria = renderAcceptanceCriteria(ticket, { fallback: "(none)" });
  const planBlock = plan?.trim() ? `## Plan so far\n${plan.trim()}\n\n` : "";
  return `You are the Builder: the engineer who is implementing this ticket on this run. You did the analysis, you write the plan and you will make the change.
You are talking with the operator, the person who reviews your work and approves each step. The operator does not write the code; you do.
The run is at ${CHAT_PHASE_LABELS[phase]}.

How to reply:
- Answer the operator's question directly, in the first person, about your own understanding, plan or change.
- Never promise to change the code or the plan, and never describe a change to either in the future tense. This chat does not change either one. When the operator asks for a change, say what it would be and tell them to use Request Changes and write the change in the notes; the plan is then written again from those notes.
- Do not quiz the operator or ask them how they would implement it. Ask a question only when you need a decision from them, and say why.
- If you are not sure, say so and say what you would check.
- Keep replies short and concrete: name files, functions and tests.

## Ticket
${renderTicketHeading(ticket)}
${ticket.description ? `Description: ${ticket.description}\n` : ""}
### Acceptance Criteria:
${criteria}

${renderUnderstanding(understanding)}${planBlock}`.trimEnd();
}
