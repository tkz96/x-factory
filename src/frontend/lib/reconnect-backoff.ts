// src/frontend/lib/reconnect-backoff.ts — Reconnect delays shared by the app-wide and run event streams.

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Exponential backoff: 1s, 2s, 4s … capped at 30s. */
export function defaultRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}
