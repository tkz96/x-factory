// src/review.ts — Fresh read-only review engine using Pi Session B.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createReviewSession,
  type PiAgentSession,
  type SessionOptions,
} from "./agents/pi.js";
import { ensureDir } from "./paths.js";
import { buildReviewPrompt } from "./prompts.js";
import type {
  Finding,
  ImplementationContext,
  ReviewResult,
  Ticket,
  VerificationResult,
} from "./types.js";

export interface ReviewContext {
  worktreePath: string;
  /** Run artifacts directory; review.json is written here, once. */
  artifactsDir: string;
  ticket: Ticket;
  plan: string;
  diff: string;
  verification: VerificationResult;
  /** What the understand stage learned; rendered into the review prompt. */
  understanding?: ImplementationContext | null | undefined;
  onEvent?: (event: {
    type: string;
    text?: string | undefined;
    tool?: string | undefined;
    error?: string | undefined;
  }) => void;
  modelConfig?: SessionOptions | undefined;
  /** Aborts an in-flight review. The review rejects and its session is disposed. */
  signal?: AbortSignal | undefined;
  sessionFactory?: ReviewSessionFactory | undefined;
}

export type ReviewSessionFactory = (
  worktreePath: string,
  options?: SessionOptions,
) => Promise<PiAgentSession>;

function attachReviewListeners(
  session: PiAgentSession,
  onEvent?: (event: {
    type: string;
    text?: string | undefined;
    tool?: string | undefined;
    error?: string | undefined;
  }) => void,
): () => string {
  let fullOutput = "";
  session.subscribe((e) => {
    if (e.type === "text" && e.text) {
      fullOutput += e.text;
      onEvent?.({ type: "info", text: e.text });
    } else if (e.type === "tool") {
      onEvent?.({ type: "info", text: `Running tool ${e.tool}` });
    } else if (e.type === "error") {
      onEvent?.({ type: "error", error: e.error });
    }
  });
  return () => fullOutput;
}

async function persistReviewArtifact(
  artifactsDir: string,
  result: ReviewResult,
): Promise<void> {
  try {
    await ensureDir(artifactsDir);
    await writeFile(
      path.join(artifactsDir, "review.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  } catch {
    // Non-fatal if disk write fails
  }
}

function abortError(): Error {
  return new Error("Review aborted");
}

/**
 * Execute a read-only review with fresh Pi Session B.
 * Writes review.json to `artifactsDir` exactly once, for every outcome except
 * abort, and always disposes the session. Rejects if `signal` aborts the review.
 */
export async function reviewRun(context: ReviewContext): Promise<ReviewResult> {
  const { artifactsDir, signal } = context;
  if (signal?.aborted) throw abortError();

  const result = await runReview(context);
  await persistReviewArtifact(artifactsDir, result);
  return result;
}

async function runReview(context: ReviewContext): Promise<ReviewResult> {
  const {
    worktreePath,
    ticket,
    plan,
    diff,
    verification,
    understanding,
    onEvent,
    signal,
  } = context;

  const reviewPrompt = buildReviewPrompt(
    ticket,
    plan,
    diff,
    verification,
    understanding,
  );

  let reviewSession: PiAgentSession;
  try {
    const makeSession = context.sessionFactory ?? createReviewSession;
    reviewSession = await makeSession(worktreePath, context.modelConfig);
  } catch (err: unknown) {
    if (signal?.aborted) throw abortError();
    const msg = err instanceof Error ? err.message : String(err);
    return createFallbackReview(
      ticket,
      `Failed to initialize read-only review session: ${msg}`,
      false,
    );
  }

  try {
    return await promptForVerdict(
      reviewSession,
      reviewPrompt,
      ticket,
      onEvent,
      signal,
    );
  } finally {
    disposeQuietly(reviewSession);
  }
}

/** Dispose must never replace the review outcome: Pi's dispose can throw. */
function disposeQuietly(session: PiAgentSession): void {
  try {
    session.dispose();
  } catch (err: unknown) {
    console.warn(
      "[X-Factory] Failed to dispose review session:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function promptForVerdict(
  reviewSession: PiAgentSession,
  reviewPrompt: string,
  ticket: Ticket,
  onEvent: ReviewContext["onEvent"],
  signal: AbortSignal | undefined,
): Promise<ReviewResult> {
  const getOutput = attachReviewListeners(reviewSession, onEvent);

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    reviewSession.abort().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    // A real Pi session ignores an abort that arrives before a prompt.
    if (aborted) throw abortError();
    await reviewSession.prompt(reviewPrompt);
  } catch (err: unknown) {
    if (aborted) throw abortError();
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (!getOutput()) {
      return createFallbackReview(
        ticket,
        `Review session error: ${errorMsg}`,
        false,
      );
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (aborted) throw abortError();

  const output = getOutput();
  if (!hasReviewVerdict(output)) {
    return createFallbackReview(
      ticket,
      "Review produced no parseable criteria or verdict.",
      false,
    );
  }
  return parseReviewOutput(ticket, output);
}

/** A review counts only if it checked criteria or stated a verdict; anything else fails closed. */
function hasReviewVerdict(output: string): boolean {
  return (
    extractReviewItems(output).criteriaChecked.length > 0 ||
    /VERDICT:\s*(PASSED|FAILED)/i.test(output)
  );
}

export function parseFindingLine(trimmed: string): Finding | null {
  const match = trimmed.match(/^-\s*\[(ERROR|WARNING|INFO)\]\s*(.+)/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    severity: match[1].toLowerCase() as "info" | "warning" | "error",
    message: match[2].trim(),
  };
}

export function parseCriteriaLine(
  trimmed: string,
): { criterion: string; satisfied: boolean } | null {
  const match = trimmed.match(/^-\s*\[(PASS|FAIL)\]\s*(.+)/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    satisfied: match[1].toUpperCase() === "PASS",
    criterion: match[2].trim(),
  };
}

export function extractReviewItems(output: string): {
  findings: Finding[];
  criteriaChecked: Array<{
    criterion: string;
    satisfied: boolean;
    notes?: string | undefined;
  }>;
} {
  const findings: Finding[] = [];
  const criteriaChecked: Array<{
    criterion: string;
    satisfied: boolean;
    notes?: string | undefined;
  }> = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const finding = parseFindingLine(trimmed);
    if (finding) {
      findings.push(finding);
      continue;
    }
    const criteria = parseCriteriaLine(trimmed);
    if (criteria) {
      criteriaChecked.push(criteria);
    }
  }

  return { findings, criteriaChecked };
}

export function evaluateReviewVerdict(
  findings: Finding[],
  criteriaChecked: Array<{
    criterion: string;
    satisfied: boolean;
    notes?: string | undefined;
  }>,
  output: string,
): { passed: boolean; summary: string } {
  const hasBlockingError = findings.some((f) => f.severity === "error");
  const hasFailedCriteria = criteriaChecked.some((c) => !c.satisfied);
  const explicitFailedVerdict =
    output.includes("VERDICT:\nFAILED") || output.includes("VERDICT: FAILED");

  const passed =
    !hasBlockingError && !hasFailedCriteria && !explicitFailedVerdict;

  const summary = passed
    ? `Review passed: all ${criteriaChecked.length} criteria satisfied with 0 blocking errors.`
    : `Review failed: ${findings.filter((f) => f.severity === "error").length} blocking errors, ${criteriaChecked.filter((c) => !c.satisfied).length} unmet criteria.`;

  return { passed, summary };
}

export function parseReviewOutput(
  ticket: Ticket,
  output: string,
): ReviewResult {
  const { findings, criteriaChecked } = extractReviewItems(output);

  if (criteriaChecked.length === 0) {
    for (const c of ticket.acceptanceCriteria) {
      criteriaChecked.push({ criterion: c, satisfied: true });
    }
  }

  const { passed, summary } = evaluateReviewVerdict(
    findings,
    criteriaChecked,
    output,
  );

  return {
    passed,
    findings,
    criteriaChecked,
    summary,
  };
}

export function createFallbackReview(
  ticket: Ticket,
  message: string,
  passed: boolean,
): ReviewResult {
  return {
    passed,
    findings: passed ? [] : [{ severity: "error", message }],
    criteriaChecked: ticket.acceptanceCriteria.map((c) => ({
      criterion: c,
      satisfied: passed,
    })),
    summary: message,
  };
}
