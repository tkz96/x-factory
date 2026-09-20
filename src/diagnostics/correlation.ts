// src/diagnostics/correlation.ts — Standard correlation format across API, worker, and workflow execution (XFM-73).

import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  request_id?: string | undefined;
  run_id?: string | undefined;
  job_id?: string | undefined;
  stage?: string | undefined;
  worker_id?: string | undefined;
  attempt?: number | undefined;
}

/**
 * Extracts or generates a unique request correlation ID from an HTTP Request.
 */
export function extractRequestId(req: Request): string {
  const existing =
    req.headers.get("x-request-id") || req.headers.get("X-Request-ID");
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }
  return `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export interface StructuredLogEntry extends CorrelationContext {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  [key: string]: unknown;
}

/**
 * Formats a structured log entry as a standard JSON string.
 */
export function formatStructuredLog(
  level: "info" | "warn" | "error",
  message: string,
  context: CorrelationContext = {},
  extra: Record<string, unknown> = {},
): StructuredLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
    ...extra,
  };
}

/**
 * Emits a structured log line to stdout or stderr.
 */
export function emitStructuredLog(
  level: "info" | "warn" | "error",
  message: string,
  context: CorrelationContext = {},
  extra: Record<string, unknown> = {},
): void {
  const entry = formatStructuredLog(level, message, context, extra);
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
