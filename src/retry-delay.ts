// src/retry-delay.ts — How long a provider asked us to wait, read from its error.
//
// One reader for every place that needs it: the model gateway (a 429 during a model
// call) and model discovery (a 429 from Check Connection). Providers say it in a few
// ways, all handled here:
//
// - Gemini's message: "Please retry in 49.58s." or, for a daily quota,
//   "Please retry in 22h59m36.48s." / "retry in 23h36.2s" — any of the h, m, s (and
//   ms) parts may be present or absent.
// - Gemini's RetryInfo detail: "retryDelay": "82776s", also when the error body is
//   itself embedded as an escaped JSON string (\"retryDelay\": \"82776s\").
// - A Retry-After header copied into the text, or "retry after 7 seconds".

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  h: 3600,
  m: 60,
  s: 1,
  ms: 0.001,
};

const DURATION_PART = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gy;

/**
 * Seconds in a Go-style duration such as "22h59m36.48s", "23h36.2s", "59m2s",
 * "41.5s" or "82776s". Undefined when the text is not one, or is zero.
 */
export function parseDurationSeconds(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  DURATION_PART.lastIndex = 0;
  let total = 0;
  let consumed = 0;
  for (
    let match = DURATION_PART.exec(trimmed);
    match;
    match = DURATION_PART.exec(trimmed)
  ) {
    const [whole, amount, unit] = match;
    total += Number(amount) * (UNIT_SECONDS[unit ?? "s"] ?? 1);
    consumed += whole.length;
  }
  if (consumed !== trimmed.length) return undefined;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** A duration: one or more number+unit parts, e.g. 22h59m36.48s. */
const DURATION = String.raw`(?:\d+(?:\.\d+)?\s*(?:ms|h|m|s))+`;

const PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`retry in (${DURATION})`, "i"),
  // Quotes may be escaped once or more when the body is embedded in a string.
  new RegExp(String.raw`\\*"retryDelay\\*"\s*:\s*\\*"(${DURATION})\\*"`, "i"),
  /retry-after:\s*(\d+(?:\.\d+)?)/i,
  /retry after (\d+(?:\.\d+)?)\s*(?:s|sec|seconds)\b/i,
];

/** The wait a provider asked for in an error text, in ms, rounded up to whole seconds. */
export function parseRetryDelayMs(text: string): number | undefined {
  for (const pattern of PATTERNS) {
    const value = text.match(pattern)?.[1];
    if (!value) continue;
    const seconds = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value)
      : parseDurationSeconds(value);
    if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds) * 1000;
    }
  }
  return undefined;
}

/** A wait as a person says it: "about 23 h", "about 15 min", "about 40 s". */
export function formatApproxWait(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds >= 3600) return `about ${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `about ${Math.round(seconds / 60)} min`;
  return `about ${seconds} s`;
}
