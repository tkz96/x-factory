// src/frontend/lib/readiness-state.ts — The one rule for "needs attention" (#323).
//
// The readiness banner and the toolbar's Degraded link both read this, so a
// warning check reads the same everywhere. A readiness answer that has not
// arrived yet, or that failed to arrive, needs no attention here: the banner
// shows its own loading or error state for that.

import type { ReadinessResponse } from "../../shared/types.js";

/** True when the workbench is not ready, or any readiness check did not pass. */
export function readinessNeedsAttention(
  readiness: ReadinessResponse | undefined,
): boolean {
  if (readiness === undefined) return false;
  if (readiness.ready === false) return true;
  return (readiness.checks ?? []).some((check) => check.status !== "pass");
}
