// src/db/row-codec.ts — The one helper for JSON columns (#179).
//
// Every repository reads and writes its JSON columns through this codec. A
// malformed column degrades only that field to a fallback instead of failing
// the whole row, so one corrupt value can never take down a listing endpoint.
//
// Degradation is a trade-off, and the fallback differs by field shape:
//
// - Typed fields — the runs JSON columns and run_commands.payload — degrade to
//   their typed fallback (null or []) because the API contract types them as
//   nullable or optional. That carries a risk for fields decisions read: a
//   corrupt `verification` degrades to null and can make a run look
//   unverified, and a corrupt `pull_request` degrades to null and can trigger
//   a re-delivery. The warning emitted on every failed parse is what makes
//   that visible.
// - Free-form diagnostic payloads — run_events.payload,
//   stage_attempts.output and operation_ledger.result — degrade to their raw
//   text, so the corruption stays visible to operators instead of vanishing.
//
// Either way, a parse failure logs a structured warning naming the table,
// column and row id, so silent degradation is never actually silent. The
// warning never contains any part of the column value: JSON parse errors
// quote raw content, and these columns hold run output that can contain
// secrets.

import { emitStructuredLog } from "../shared/correlation.js";

/**
 * Parses a JSON column. A null column and a malformed one both yield the
 * fallback, so the caller decides what a degraded field looks like. A
 * malformed column additionally logs a warning through the structured logger,
 * naming the table, column and row id it failed on.
 */
export function parseJsonColumn<T>(
  raw: string | null | undefined,
  fallback: T,
  ref: { table: string; column: string; rowId: string },
): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    emitStructuredLog(
      "warn",
      `Malformed JSON column ${ref.table}.${ref.column} for row ${ref.rowId}; degrading to fallback`,
      {},
      {
        table: ref.table,
        column: ref.column,
        row_id: ref.rowId,
        // Never the parse error itself: JSON engines quote the raw column
        // value in their messages (Bun: `Unexpected identifier "sk"`), and
        // these columns hold run output that can contain secrets. The error
        // class name and the column length leak nothing about the content.
        parse_error: err instanceof Error ? err.constructor.name : typeof err,
        column_length: raw.length,
      },
    );
    return fallback;
  }
}

/**
 * Serializes a value for a JSON column. Nullish becomes SQL NULL; everything
 * else — strings included — is JSON-encoded, so a value written through this
 * helper always round-trips through parseJsonColumn unchanged. Never pass
 * pre-serialized text: it would be double-encoded on write and degrade on the
 * next read.
 */
export function serializeJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}
