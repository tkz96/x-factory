// src/frontend/components/feedback/RetryAction.tsx — The uniform retry
// affordance (#135, resolution #132). Every error and stale state offers the
// same recovery action; no dead-end states (spec #133 user story 61). It is the
// button block since #251, so press, keyboard and disabled semantics come from
// the one control vocabulary.

import { Button } from "../ui/Button.js";
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
    <Button
      variant="secondary"
      size="sm"
      icon="icon-refresh-cw"
      className="retry-action"
      isDisabled={disabled}
      onPress={onRetry}
    >
      {label ?? STATE_COPY.retry}
    </Button>
  );
}
