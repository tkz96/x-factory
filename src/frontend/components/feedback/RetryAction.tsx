// src/frontend/components/feedback/RetryAction.tsx — The uniform retry
// affordance (#135, resolution #132). Every error and stale state offers the
// same recovery action; no dead-end states (spec #133 user story 61).

import { STATE_COPY } from "./copy-map.js";
import "./RetryAction.css";

export interface RetryActionProps {
  /** Retry (error regions) or refresh (stale regions). */
  onRetry?: (() => void) | undefined;
  /** Disabled while rate-limit timed guidance is counting down. */
  disabled?: boolean | undefined;
  /** Overrides the canonical retry label (e.g. the stale-region "Refresh"). */
  label?: string | undefined;
}

export function RetryAction({
  onRetry,
  disabled = false,
  label,
}: RetryActionProps) {
  return (
    <button
      type="button"
      className="retry-action btn-secondary btn-sm"
      onClick={onRetry}
      disabled={disabled}
    >
      <svg className="icon icon-sm" aria-hidden="true">
        <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
      </svg>
      {label ?? STATE_COPY.retry}
    </button>
  );
}
