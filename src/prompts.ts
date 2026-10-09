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
 * bare `ID — Title` line used by the PR body.
 */
export function renderTicketHeading(
  ticket: Ticket,
  options?: { hash?: boolean },
): string {
  if (options?.hash === false) return `${ticket.id} — ${ticket.title}`;
  return `#${ticket.id} — ${ticket.title}`;
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

  const testCmd = project.testCommand || "bun test";
  const typecheckCmd = project.typecheckCommand
    ? `- Typecheck Command: \`${project.typecheckCommand}\``
    : "";
  const lintCmd = project.lintCommand
    ? `- Lint Command: \`${project.lintCommand}\``
    : "";

  return `# Ralph Loop Task Execution Protocol (Matt Pocock TDD Protocol)

## Ticket: ${renderTicketHeading(ticket)}
${ticket.description ? `${ticket.description}\n` : ""}### Acceptance Criteria:
${acList}

### Verification Commands:
- Test Command: \`${testCmd}\`
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
   - Run the test suite using the project's test command (\`${testCmd}\`).
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

  if (!verification.tests.passed) {
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
${ticket.description ? `Description: ${ticket.description}\n` : ""}### Acceptance Criteria:
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

Format your response clearly:

CRITERIA_CHECK:
- [PASS|FAIL] <criterion description>

FINDINGS:
- [INFO|WARNING|ERROR] <finding description> (file:path, line:N if applicable)

VERDICT:
[PASSED|FAILED] - <concise summary>`;
}
