// src/verification.ts — Deterministic verification pipeline and structured bounded repair.

import type {
  Project,
  Ticket,
  CommandResult,
  VerificationResult,
} from "./types.js";
import { execCommand } from "./proc.js";
import { checkPollution, getDiff, type BaselineState } from "./git.js";

export const MAX_REPAIR_ATTEMPTS = 3;

async function runOptionalCommand(
  cmd: string | undefined,
  cwd: string,
  timeoutMs?: number
): Promise<CommandResult | undefined> {
  if (!cmd) return undefined;
  return execCommand("sh", ["-c", cmd], { cwd, timeoutMs });
}

function buildVerificationSummary(
  tests: CommandResult,
  typecheck: CommandResult | undefined,
  lint: CommandResult | undefined,
  hasPollution: boolean,
  pollutionDetails: string[],
  hasDiff: boolean
): string {
  const parts: string[] = [
    tests.passed ? "Tests passed" : `Tests failed (exit ${tests.exitCode})`,
  ];
  if (typecheck) {
    parts.push(typecheck.passed ? "Typecheck passed" : `Typecheck failed (exit ${typecheck.exitCode})`);
  }
  if (lint) {
    parts.push(lint.passed ? "Lint passed" : `Lint failed (exit ${lint.exitCode})`);
  }
  if (hasPollution) {
    parts.push(`Pollution detected: ${pollutionDetails.join("; ")}`);
  }
  if (!hasDiff) {
    parts.push("No implementation changes detected in worktree diff");
  }
  return parts.join(" | ");
}

/**
 * Run deterministic verification checks on the worktree.
 * 1. Test command
 * 2. Optional typecheck command
 * 3. Optional lint command
 * 4. Pollution detection against baseline
 * 5. Git diff inspection (verifies non-empty diff)
 */
export async function runVerification(
  worktreePath: string,
  project: Project,
  baseline: BaselineState,
  attempt: number
): Promise<VerificationResult> {
  const timeoutMs = project.commandTimeoutMs;

  const tests: CommandResult = await execCommand("sh", ["-c", project.testCommand], {
    cwd: worktreePath,
    timeoutMs,
  });
  const typecheck = await runOptionalCommand(project.typecheckCommand, worktreePath, timeoutMs);
  const lint = await runOptionalCommand(project.lintCommand, worktreePath, timeoutMs);
  const pollution = await checkPollution(worktreePath, baseline);
  const { diff, filesChanged } = await getDiff(worktreePath);
  const hasDiff = diff.length > 0 || filesChanged.length > 0;

  const passed =
    tests.passed &&
    (typecheck ? typecheck.passed : true) &&
    (lint ? lint.passed : true) &&
    !pollution.hasPollution &&
    hasDiff;

  const summary = buildVerificationSummary(
    tests,
    typecheck,
    lint,
    pollution.hasPollution,
    pollution.details,
    hasDiff
  );

  return {
    passed,
    repairAttempt: attempt,
    tests,
    typecheck,
    lint,
    diff,
    filesChanged,
    hasPollution: pollution.hasPollution,
    pollutionDetails: pollution.hasPollution ? pollution.details : undefined,
    summary,
  };
}

/**
 * Format a tightly scoped repair prompt for Pi when deterministic verification fails.
 */
export function buildRepairPrompt(
  ticket: Ticket,
  plan: string,
  verification: VerificationResult,
  attempt: number
): string {
  const failedParts: string[] = [];

  if (!verification.tests.passed) {
    failedParts.push(`### Test Failure (${verification.tests.command}):\n\`\`\`\n${verification.tests.stderr || verification.tests.stdout}\n\`\`\``);
  }
  if (verification.typecheck && !verification.typecheck.passed) {
    failedParts.push(`### Typecheck Failure (${verification.typecheck.command}):\n\`\`\`\n${verification.typecheck.stderr || verification.typecheck.stdout}\n\`\`\``);
  }
  if (verification.lint && !verification.lint.passed) {
    failedParts.push(`### Lint Failure (${verification.lint.command}):\n\`\`\`\n${verification.lint.stderr || verification.lint.stdout}\n\`\`\``);
  }
  if (verification.hasPollution && verification.pollutionDetails) {
    failedParts.push(`### Pollution Detected:\n${verification.pollutionDetails.join("\n")}`);
  }
  if (verification.filesChanged.length === 0) {
    failedParts.push(`### No Changes:\nNo code changes were made to address the ticket.`);
  }

  const criteriaBlock =
    ticket.acceptanceCriteria.length > 0
      ? `\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "";

  return `Deterministic verification checks failed on attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}.

## Ticket
#${ticket.id} — ${ticket.title}${criteriaBlock}

## Implementation Plan
${plan}

## Verification Failures
${failedParts.join("\n\n")}

## Current Changed Files
${verification.filesChanged.join("\n") || "None"}

## Repair Instructions
1. Fix ONLY the issues required to make verification checks and tests pass.
2. Do NOT rewrite unrelated code or introduce speculative changes.
3. Clean up any temporary or debug files.
4. Ensure the implementation completely satisfies the ticket and acceptance criteria.`;
}
