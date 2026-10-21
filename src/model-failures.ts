// src/model-failures.ts — How a failed model call is told, in three places.
//
// A provider's error text is often nested JSON (Gemini wraps its error body as a string
// inside another error), so it is never shown as it is. This module reads it once and
// says the failure three ways:
//
// - the timeline: one short sentence (`modelErrorSentence`), e.g. "Gemini rejected the
//   request: quota exceeded for gemini-3.8-flash.";
// - the run's failure reason: what happened to which model, and what the operator can do
//   (`modelStageFailure`), with no retry when the same call would fail again;
// - diagnostics: the raw provider text, kept on the stage attempt record and the status
//   event's technical `text`.

import type { StageOutcome } from "./executors/types.js";
import {
  isRetryableModelFailure,
  ModelUnavailableError,
  modelFailureReason,
  type ResolvedModel,
} from "./model-roles.js";
import { formatApproxWait } from "./retry-delay.js";
import type { FailureReason } from "./shared/failure-reason.js";

/**
 * The provider says the model does not exist or is no longer offered: Gemini's
 * NOT_FOUND, Anthropic's not_found_error, OpenAI's model_not_found, a 404 code in an
 * error body, or a sentence that says so about the model.
 */
const MODEL_NOT_FOUND =
  /\bNOT_FOUND\b|\bnot_found_error\b|\bmodel_not_found\b|no longer available|\bcode\\*"?\s*:\s*404\b|\bmodel\b[^\n]{0,200}?\b(?:not found|does not exist|is not supported|is not available)\b/i;

export function isModelNotFoundMessage(text: string): boolean {
  return MODEL_NOT_FOUND.test(text);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The provider's own message, dug out of nested error bodies: `{"error": {"message":
 * "<another error body as a string>"}}` is followed down to its innermost message.
 * Text that is not JSON is returned as it is.
 */
export function innermostProviderMessage(raw: string): string {
  let text = raw.trim();
  for (let depth = 0; depth < 5; depth++) {
    const start = text.indexOf("{");
    if (start === -1) break;
    const parsed = parseJson(text.slice(start)) as
      | { error?: { message?: unknown } | string; message?: unknown }
      | undefined;
    if (!parsed || typeof parsed !== "object") break;
    const inner =
      typeof parsed.error === "object" && parsed.error
        ? parsed.error.message
        : typeof parsed.error === "string"
          ? parsed.error
          : parsed.message;
    if (typeof inner !== "string" || !inner.trim()) break;
    text = inner.trim();
  }
  return text;
}

/** The first sentence of a provider message, capped so it reads as one line. */
export function firstSentence(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? line : line.slice(0, end + 1);
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** The provider's message in one sentence: what a person reads instead of the raw body. */
export function providerSentence(raw: string): string {
  return firstSentence(innermostProviderMessage(raw));
}

/**
 * The provider's sentence for a model it does not offer, read out of a WHOLE
 * process output. The error can sit anywhere in the output, so the sentence is
 * taken from the last line that names a missing model — never from a tail
 * window that can start mid-sentence ("…ck another model…"). Falls back to the
 * tail of the output when no line names the failure.
 */
export function modelNotFoundSentence(output: string): string {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line || !isModelNotFoundMessage(line)) continue;
    return firstSentence(innermostProviderMessage(line));
  }
  return firstSentence(output.trim().slice(-500));
}

/** The provider as a person would name it. */
export function providerLabel(resolved: ResolvedModel): string {
  if (resolved.apiType === "gemini") return "Gemini";
  if (resolved.apiType === "anthropic") return "Anthropic";
  return `"${resolved.connectionName}"`;
}

function roleLabel(resolved: ResolvedModel): string {
  return resolved.role === "builder" ? "Builder" : "Reviewer";
}

/** The one timeline sentence for a failed model call. */
export function modelErrorSentence(
  err: unknown,
  resolved: ResolvedModel,
): string {
  const provider = providerLabel(resolved);
  const model = resolved.modelId;
  if (err instanceof ModelUnavailableError) {
    switch (err.category) {
      case "model not found":
        return `${provider} says ${model} isn't available: ${providerSentence(err.raw ?? err.message)}`;
      case "quota exhausted":
        return `${provider} rejected the request: quota exceeded for ${model}.`;
      case "rate limited":
        return `${provider} kept rate limiting ${model}, so the call was stopped.`;
      case "key rejected":
        return `${provider} rejected the API key of "${resolved.connectionName}".`;
      default:
        return err.message;
    }
  }
  const raw = err instanceof Error ? err.message : String(err);
  return `${provider} returned an error for ${model}: ${providerSentence(raw)}`;
}

/** What the run's failure says for a model failure it can name exactly. */
function failureFor(
  err: ModelUnavailableError,
  resolved: ResolvedModel,
): FailureReason | undefined {
  const model = resolved.modelId;
  const role = roleLabel(resolved);
  switch (err.category) {
    case "model not found":
      return {
        category: "model",
        message: `The model ${model} isn't available from ${providerLabel(resolved)}.`,
        recovery: `Choose another model for the ${role} in Settings › Models, then start a new run.`,
      };
    case "quota exhausted":
      return {
        category: "model",
        message:
          err.retryAfterMs === undefined
            ? `The provider's quota for ${model} is used up.`
            : `The provider's quota for ${model} is used up. It resets in ${formatApproxWait(err.retryAfterMs)}.`,
        recovery: `Choose another model for the ${role} in Settings › Models and start a new run, or wait for the quota to reset.`,
      };
    case "key rejected":
      return {
        category: "model",
        message: `${providerLabel(resolved)} rejected the API key of "${resolved.connectionName}".`,
        recovery: "Check the key in Settings › Models, then start a new run.",
      };
    case "context too large":
      return {
        category: "model",
        message: `The prompt is too large for ${model}'s context window.`,
        recovery: `Choose a model with a larger context window for the ${role} in Settings › Models, then start a new run.`,
      };
    default:
      return undefined;
  }
}

/**
 * The stage outcome for a model failure: the reason (with the raw provider text kept for
 * diagnostics), the failure the run shows, and whether a retry could help.
 */
export function modelStageFailure(
  err: ModelUnavailableError,
  resolved: ResolvedModel | undefined,
): Extract<StageOutcome, { outcome: "error" }> {
  const reason = modelFailureReason(err);
  const error =
    err.raw && !reason.includes(err.raw)
      ? `${reason} Provider response: ${err.raw}`
      : reason;
  const failure = resolved ? failureFor(err, resolved) : undefined;
  return {
    outcome: "error",
    error,
    ...(failure ? { failure } : {}),
    ...(isRetryableModelFailure(err) ? {} : { retryable: false }),
  };
}
