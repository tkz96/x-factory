// src/db/row-codec.ts — The one helper for JSON columns (#179).
//
// Every repository reads and writes its JSON columns through this codec. A
// malformed column degrades only that field to a fallback instead of failing
// the whole row, so one corrupt value can never take down a listing endpoint.

/**
 * Parses a JSON column. A null column and a malformed one both yield the
 * fallback, so the caller decides what a degraded field looks like.
 */
export function parseJsonColumn<T>(
  raw: string | null | undefined,
  fallback: T,
): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Serializes a value for a JSON column. Strings pass through unchanged
 * (callers that store pre-serialized text keep it verbatim); nullish becomes
 * SQL NULL; everything else is JSON.
 */
export function serializeJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}
