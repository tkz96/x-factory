// src/verification.ts — Deterministic verification pipeline and structured bounded repair.

import { getDiffText } from "./git.js";
import { execCommand } from "./proc.js";
import type { CommandResult, Project, VerificationResult } from "./types.js";
import { type BaselineState, readWorktreeState } from "./worktree-state.js";

export const MAX_REPAIR_ATTEMPTS = 3;

interface VerificationOptions {
  signal?: AbortSignal | undefined;
}

async function runOptionalCommand(
  cmd: string | undefined,
  cwd: string,
  timeoutMs?: number | undefined,
  options?: VerificationOptions,
): Promise<CommandResult | undefined> {
  if (!cmd) return undefined;
  return execCommand("sh", ["-c", cmd], {
    cwd,
    timeoutMs,
    envPolicy: "sanitized",
    signal: options?.signal,
  });
}

function buildVerificationSummary(
  tests: CommandResult,
  typecheck: CommandResult | undefined,
  lint: CommandResult | undefined,
  hasPollution: boolean,
  pollutionDetails: string[],
  hasImplementationChanges: boolean,
): string {
  const parts: string[] = [
    tests.passed ? "Tests passed" : `Tests failed (exit ${tests.exitCode})`,
  ];
  if (typecheck) {
    parts.push(
      typecheck.passed
        ? "Typecheck passed"
        : `Typecheck failed (exit ${typecheck.exitCode})`,
    );
  }
  if (lint) {
    parts.push(
      lint.passed ? "Lint passed" : `Lint failed (exit ${lint.exitCode})`,
    );
  }
  if (hasPollution) {
    parts.push(`Pollution detected: ${pollutionDetails.join("; ")}`);
  }
  if (!hasImplementationChanges) {
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
 * 5. No-change gate: at least one implementation change (scaffold does not count)
 */
export async function runVerification(
  worktreePath: string,
  project: Project,
  baseline: BaselineState,
  attempt: number,
  options?: VerificationOptions,
): Promise<VerificationResult> {
  const timeoutMs = project.commandTimeoutMs;

  const tests: CommandResult = await execCommand(
    "sh",
    ["-c", project.testCommand],
    {
      cwd: worktreePath,
      timeoutMs,
      envPolicy: "sanitized",
      signal: options?.signal,
    },
  );
  const typecheck = await runOptionalCommand(
    project.typecheckCommand,
    worktreePath,
    timeoutMs,
    options,
  );
  const lint = await runOptionalCommand(
    project.lintCommand,
    worktreePath,
    timeoutMs,
    options,
  );
  const state = await readWorktreeState(worktreePath, baseline);
  const diff = await getDiffText(worktreePath, state);

  const passed =
    tests.passed &&
    (typecheck ? typecheck.passed : true) &&
    (lint ? lint.passed : true) &&
    !state.hasPollution &&
    state.hasImplementationChanges;

  const summary = buildVerificationSummary(
    tests,
    typecheck,
    lint,
    state.hasPollution,
    state.pollutionDetails,
    state.hasImplementationChanges,
  );

  return {
    passed,
    repairAttempt: attempt,
    tests,
    typecheck,
    lint,
    diff,
    filesChanged: state.implementationPaths,
    hasPollution: state.hasPollution,
    pollutionDetails: state.hasPollution ? state.pollutionDetails : undefined,
    summary,
  };
}
