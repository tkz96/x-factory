// src/frontend/components/feedback/AsyncRegion.tsx — Renders the five-state
// async taxonomy from a derived state enum; it never sees the query (#135,
// resolution #132). Consumers derive with `deriveAsyncState` and hand the
// result here. Loading is an indeterminate spinner in a reserved region (no
// layout shift, no skeleton/shimmer); error shows normalized copy + retry;
// partial and stale keep the content on screen with diagnostics rendered
// inline — precedence never discards diagnostics.
//
// State colors follow spec #133: error→red, warning/partial→orange,
// valid→green, loading/stale→neutral.

import type { ReactNode } from "react";
import {
  formatRetryCountdown,
  isNormalizedError,
  resolveErrorCopy,
  STATE_COPY,
} from "./copy-map.js";
import { FeedbackBanner } from "./FeedbackBanner.js";
import { RetryAction } from "./RetryAction.js";
import type { DerivedAsyncState } from "./types.js";
import { useRetryCountdown } from "./use-retry-countdown.js";
import "./AsyncRegion.css";

export interface AsyncRegionProps {
  /** From `deriveAsyncState` — never a raw query. */
  derived: DerivedAsyncState;
  /** Wired to the query's refetch: retry for errors, refresh for stale. */
  onRetry?: () => void;
  /** Partial banner detail: exactly which parts failed (spec user story 31). */
  failedParts?: readonly string[];
  /** Overrides the canonical empty guidance for this region. */
  emptyCopy?: string;
  children?: ReactNode;
}

export function AsyncRegion({
  derived,
  onRetry,
  failedParts,
  emptyCopy,
  children,
}: AsyncRegionProps) {
  const retryAfterMs = isNormalizedError(derived.error)
    ? derived.error.retryAfterMs
    : undefined;
  const remainingMs = useRetryCountdown(retryAfterMs);
  const rateLimited = remainingMs !== undefined && remainingMs > 0;
  const hasSuppressedError = derived.suppressed.includes("error");
  const showPartial =
    derived.state === "partial" || derived.suppressed.includes("partial");

  if (derived.state === "loading") {
    return (
      <div className="async-region async-region--loading" role="status">
        <svg className="icon icon-lg icon-spin" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-loader-2" />
        </svg>
        <p className="async-region-hint">{STATE_COPY.loading}</p>
      </div>
    );
  }

  if (derived.state === "error") {
    return (
      <div className="async-region async-region--error" role="status">
        <svg className="icon icon-xl" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-alert-circle" />
        </svg>
        <p className="async-region-hint">{resolveErrorCopy(derived.error)}</p>
        {onRetry !== undefined && (
          <div className="async-region-actions">
            {remainingMs !== undefined && remainingMs > 0 && (
              <span className="feedback-countdown">
                {formatRetryCountdown(remainingMs)}
              </span>
            )}
            <RetryAction onRetry={onRetry} disabled={rateLimited} />
          </div>
        )}
      </div>
    );
  }

  if (derived.state === "empty") {
    return (
      <div className="async-region async-region--empty" role="status">
        <svg className="icon icon-xl" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-info" />
        </svg>
        <p className="async-region-hint">{emptyCopy ?? STATE_COPY.empty}</p>
        {children}
      </div>
    );
  }

  // ready | partial | stale — content stays on screen; diagnostics inline.
  // Suppressed diagnostics render unconditionally: precedence never discards
  // them, even when the consumer wires no retry handler.
  return (
    <div className="async-region">
      {derived.state === "stale" && (
        <div className="async-region-stale">
          <span className="async-region-stale-badge">{STATE_COPY.stale}</span>
          {onRetry !== undefined && (
            <RetryAction onRetry={onRetry} label={STATE_COPY.refresh} />
          )}
        </div>
      )}
      {children}
      {showPartial && (
        <FeedbackBanner
          tone="warning"
          message={STATE_COPY.partial}
          items={failedParts}
        />
      )}
      {hasSuppressedError && (
        <FeedbackBanner
          tone="error"
          message={resolveErrorCopy(derived.error)}
          retryAfterMs={retryAfterMs}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}
