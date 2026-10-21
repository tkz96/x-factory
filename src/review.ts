// src/review.ts — Fresh read-only review engine using Pi Session B.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertFitsContextWindow,
  classifyModelError,
  createReadOnlySession,
  disposeQuietly,
  type PiAgentSession,
  type PiUsage,
  type ReadOnlySessionFactory,
  type SessionOptions,
} from "./agents/pi.js";
import {
  type GatewayKey,
  gatewayKeyFor,
  modelGateway,
} from "./model-gateway.js";
import { ModelUnavailableError, type ResolvedModel } from "./model-roles.js";
import { ensureDir } from "./paths.js";
import { buildReviewPrompt } from "./prompts.js";
import type {
  Finding,
  ImplementationContext,
  ReviewCriterionResult,
  ReviewResult,
  Ticket,
  VerificationResult,
} from "./types.js";

/** One activity line from the read-only review session (#256). */
export interface ReviewActivityEvent {
  type: "info" | "tool" | "error";
  text?: string | undefined;
  tool?: string | undefined;
  error?: string | undefined;
}

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
  onEvent?: ((event: ReviewActivityEvent) => void) | undefined;
  /** The Reviewer role's model (#278); the default Pi session requires it. */
  modelConfig?: SessionOptions | undefined;
  /** Told about each rate-limit wait before it happens (#280). */
  onWait?: ((ms: number, reason: string) => void) | undefined;
  /** Receives the tokens and cost the review session reported (#279). */
  onUsage?: ((usage: PiUsage) => void) | undefined;
  /** Aborts an in-flight review. The review rejects and its session is disposed. */
  signal?: AbortSignal | undefined;
  sessionFactory?: ReadOnlySessionFactory | undefined;
  /** Asserts that calling the reviewer model does not exceed its daily budget (#281). */
  assertBudget?: ((resolved: ResolvedModel) => void) | undefined;
  /** Counts the review prompt as one model call towards the daily budget (#281). */
  recordCall?: (() => void) | undefined;
}

function attachReviewListeners(
  session: PiAgentSession,
  onEvent?: ((event: ReviewActivityEvent) => void) | undefined,
): () => string {
  let fullOutput = "";
  session.subscribe((e) => {
    if (e.type === "text" && e.text) {
      fullOutput += e.text;
      onEvent?.({ type: "info", text: e.text });
    } else if (e.type === "tool") {
      // The tool's name rides along so the caller can forward the activity as its own event.
      onEvent?.({ type: "tool", text: `Running tool ${e.tool}`, tool: e.tool });
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

  // Refused before a session opens: a prompt that cannot fit is never sent (#280).
  if (context.modelConfig) {
    assertFitsContextWindow(context.modelConfig.resolved, reviewPrompt);
  }

  let reviewSession: PiAgentSession;
  try {
    if (!context.sessionFactory && !context.modelConfig) {
      // No silent fallback to a runtime default model (#278).
      throw new ModelUnavailableError(
        "Reviewer has no model. Choose a model in Settings › Models.",
      );
    }
    reviewSession = context.sessionFactory
      ? await context.sessionFactory(worktreePath, context.modelConfig)
      : await createReadOnlySession(
          worktreePath,
          context.modelConfig as SessionOptions,
        );
  } catch (err: unknown) {
    if (signal?.aborted) throw abortError();
    if (err instanceof ModelUnavailableError) throw err;
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
      (() => {
        const modelConfig = context.modelConfig;
        if (!modelConfig) return undefined;
        const assertBudget = context.assertBudget;
        const recordCall = context.recordCall;
        return {
          key: gatewayKeyFor(modelConfig.resolved, {
            checkBudget: assertBudget
              ? () => assertBudget(modelConfig.resolved)
              : undefined,
            recordCall,
          }),
          onWait: context.onWait,
        };
      })(),
    );
  } finally {
    const usage = reviewSession.usage?.();
    if (usage && context.onUsage) context.onUsage(usage);
    disposeQuietly(reviewSession);
  }
}

async function promptForVerdict(
  reviewSession: PiAgentSession,
  reviewPrompt: string,
  ticket: Ticket,
  onEvent: ReviewContext["onEvent"],
  signal: AbortSignal | undefined,
  gate?: {
    key: GatewayKey;
    onWait?: ((ms: number, reason: string) => void) | undefined;
  },
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
    if (gate) {
      // Paced and queued per model; a 429 waits instead of failing (#280).
      await modelGateway.run(
        gate.key,
        async () => {
          try {
            await reviewSession.prompt(reviewPrompt);
          } catch (err: unknown) {
            throw classifyModelError(
              err instanceof Error ? err.message : String(err),
            );
          }
        },
        { onWait: gate.onWait, signal },
      );
    } else {
      await reviewSession.prompt(reviewPrompt);
    }
  } catch (err: unknown) {
    if (aborted) throw abortError();
    const errorMsg = err instanceof Error ? err.message : String(err);
    // A model that can't be used — a rejected key, or a rate limit the
    // gateway gave up on — fails the stage; it is not a review verdict.
    if (err instanceof ModelUnavailableError) throw err;
    const classified = classifyModelError(errorMsg);
    if (classified instanceof ModelUnavailableError) throw classified;
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
    parseReviewVerdict(output) !== null
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
): { criterion: string; status: "pass" | "fail" } | null {
  const match = trimmed.match(/^-\s*\[(PASS|FAIL)\]\s*(.+)/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    status: match[1].toUpperCase() === "PASS" ? "pass" : "fail",
    criterion: match[2].trim(),
  };
}

/**
 * The Reviewer's verdict, read tolerantly: any case, and tolerant of the
 * whitespace and markdown a model may wrap it in ("VERDICT: FAILED",
 * "VERDICT:\nFAILED", "**VERDICT:** FAILED", "Verdict - fail"). The last
 * verdict stated in the output wins. No verdict is `null`, never a pass.
 */
export function parseReviewVerdict(output: string): "pass" | "fail" | null {
  const matches = [
    ...output.matchAll(/verdict[^a-z0-9]{0,10}(pass(?:ed)?|fail(?:ed)?)\b/gi),
  ];
  const last = matches.at(-1)?.[1];
  if (!last) return null;
  return last.toLowerCase().startsWith("pass") ? "pass" : "fail";
}

export function extractReviewItems(output: string): {
  findings: Finding[];
  criteriaChecked: Array<{ criterion: string; status: "pass" | "fail" }>;
} {
  const findings: Finding[] = [];
  const criteriaChecked: Array<{ criterion: string; status: "pass" | "fail" }> =
    [];

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
  criteriaChecked: ReviewCriterionResult[],
  output: string,
): { passed: boolean; summary: string } {
  const blockingErrors = findings.filter((f) => f.severity === "error").length;
  const unmet = criteriaChecked.filter((c) => c.status === "fail").length;
  const notAssessed = criteriaChecked.filter(
    (c) => c.status === "not_assessed",
  ).length;
  const verdict = parseReviewVerdict(output);
  // No verdict only stands when there was something to assess and it all passed;
  // a review that assessed nothing and stated nothing is doubt enough to fail.
  const verdictDoubtful = verdict === null && criteriaChecked.length === 0;

  const passed =
    blockingErrors === 0 &&
    unmet === 0 &&
    notAssessed === 0 &&
    verdict !== "fail" &&
    !verdictDoubtful;

  const summary = passed
    ? `Review passed: all ${criteriaChecked.length} criteria satisfied with 0 blocking errors.`
    : `Review failed: ${blockingErrors} blocking errors, ${unmet} unmet criteria, ${notAssessed} not assessed.`;

  return { passed, summary };
}

/**
 * How a Reviewer line is matched to a ticket criterion: lowercased, with list
 * markers and numbering stripped and every non-alphanumeric run collapsed to
 * one space, so "1. Sanitize passwords from audit payload." matches
 * "Sanitize passwords from audit payload".
 */
function criterionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A leading criterion number on a Reviewer line: `1.`, `1)`, `#1`,
 * `Criterion 1:` or `AC1:`. The number must stand alone, so `1.5` is not `1.`.
 */
const LEADING_NUMBER =
  /^(?:#(\d+)\b|(?:criterion|ac)\s*#?(\d+)\s*[:.)]|(\d+)[.)](?=\s|$))\s*/i;

/** The separators that may open a Reviewer's evidence after the criterion text. */
const EVIDENCE_SEPARATOR = /\s+[—–-]\s+|:\s+|\s*\(/g;

/**
 * The evidence a Reviewer wrote after the criterion: the text after the first
 * separator that follows the criterion text (or the first separator, when the
 * criterion is paraphrased). `undefined` when there is none.
 */
function splitEvidence(body: string, key: string): string | undefined {
  const separators = [...body.matchAll(EVIDENCE_SEPARATOR)];
  const chosen =
    separators.find((m) =>
      criterionKey(body.slice(0, m.index)).includes(key),
    ) ?? separators[0];
  if (chosen?.index === undefined) return undefined;
  let notes = body.slice(chosen.index + chosen[0].length).trim();
  if (chosen[0].trim() === "(") notes = notes.replace(/\)$/, "").trim();
  return notes || undefined;
}

/**
 * The ticket criterion a Reviewer line is about, or `null` when it is about
 * none. A leading number decides on its own: it must be 1..criteria count, and
 * a number out of range matches nothing. Otherwise the line matches the
 * criterion whose normalised text it contains (the longest, when several).
 */
function matchReviewerLine(
  line: string,
  keys: readonly string[],
): { index: number; notes: string | undefined } | null {
  const numbered = line.match(LEADING_NUMBER);
  if (numbered) {
    const n = Number(numbered[1] ?? numbered[2] ?? numbered[3]);
    if (!Number.isInteger(n) || n < 1 || n > keys.length) return null;
    const index = n - 1;
    const body = line.slice(numbered[0].length);
    return { index, notes: splitEvidence(body, keys[index] ?? "") };
  }
  const text = criterionKey(line);
  let index = -1;
  keys.forEach((key, i) => {
    if (!key || !text.includes(key)) return;
    if (index < 0 || key.length > (keys[index]?.length ?? 0)) index = i;
  });
  if (index < 0) return null;
  return { index, notes: splitEvidence(line, keys[index] ?? "") };
}

export function parseReviewOutput(
  ticket: Ticket,
  output: string,
): ReviewResult {
  const { findings, criteriaChecked: assessed } = extractReviewItems(output);

  // One entry per ticket criterion. Each Reviewer line is matched to the
  // criterion it numbers or names (see matchReviewerLine); a FAIL wins over a
  // PASS for the same criterion, and lines that match no criterion are never
  // counted. A criterion with no matching line stays not_assessed, never satisfied.
  const keys = ticket.acceptanceCriteria.map(criterionKey);
  const judged: Array<
    Array<{ status: "pass" | "fail"; notes?: string | undefined }>
  > = ticket.acceptanceCriteria.map(() => []);
  for (const line of assessed) {
    const match = matchReviewerLine(line.criterion, keys);
    if (match)
      judged[match.index]?.push({ status: line.status, notes: match.notes });
  }

  const criteriaChecked: ReviewCriterionResult[] =
    ticket.acceptanceCriteria.map((criterion, i) => {
      const lines = judged[i] ?? [];
      const decisive =
        lines.find((l) => l.status === "fail") ??
        lines.find((l) => l.status === "pass");
      if (!decisive) return { criterion, status: "not_assessed" };
      return decisive.notes
        ? { criterion, status: decisive.status, notes: decisive.notes }
        : { criterion, status: decisive.status };
    });

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
    // A fallback review never ran the Reviewer, so nothing was assessed.
    criteriaChecked: ticket.acceptanceCriteria.map((c) => ({
      criterion: c,
      status: "not_assessed" as const,
    })),
    summary: message,
  };
}
