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
import { Badge } from "../ui/Badge.js";
import { PlaceholderRows } from "../ui/ListRow.js";
import { Spinner } from "../ui/Spinner.js";
import {
  formatRetryCountdown,
  resolveErrorCopy,
  STATE_COPY,
  unwrapNormalizedError,
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
  onRetry?: (() => void) | undefined;
  /** Partial banner detail: exactly which parts failed (spec user story 31). */
  failedParts?: readonly string[] | undefined;
  /**
   * Overrides the canonical error guidance for this region — for a failure
   * whose cause the region knows (e.g. a project with no tracker connection,
   * #147). The raw payload is still never rendered.
   */
  errorCopy?: string | undefined;
  /** Overrides the error region's retry label (e.g. the repair path, #147). */
  retryLabel?: string | undefined;
  /**
   * The empty state's headline: what is not here, in a few words (E3). A region
   * without one falls back to the canonical line as its own headline.
   */
  emptyTitle?: string | undefined;
  /** Overrides the canonical empty guidance for this region. */
  emptyCopy?: string | undefined;
  /** The empty state's glyph — a sprite icon that fits what is missing (E3). */
  emptyIcon?: string | undefined;
  /** The empty state's optional call-to-action (e.g. the onboard button). */
  emptyAction?: ReactNode | undefined;
  /** Region content — rendered in ready, partial, and stale. */
  children?: ReactNode | undefined;
  /**
   * Lists only: how many static placeholder rows to reserve while loading. The
   * rows hold the height the loaded rows will have, so the list never jumps
   * (docs/reference/state-coverage.md). Without it, loading is the standard
   * inline spinner, for small waits.
   */
  placeholderRows?: number | undefined;
  /**
   * Lists only: the reserved rows wear the inset group's box, so a loading list
   * has the shape of the loaded one.
   */
  placeholderGroup?: boolean | undefined;
}

export function AsyncRegion({
  derived,
  onRetry,
  failedParts,
  errorCopy,
  retryLabel,
  emptyTitle,
  emptyCopy,
  emptyIcon = "icon-info",
  emptyAction,
  children,
  placeholderRows,
  placeholderGroup,
}: AsyncRegionProps) {
  const normalized = unwrapNormalizedError(derived.error);
  const retryAfterMs = normalized?.retryAfterMs;
  const remainingMs = useRetryCountdown(retryAfterMs);
  const rateLimited = remainingMs !== undefined && remainingMs > 0;
  const hasSuppressedError = derived.suppressed.includes("error");
  const showPartial =
    derived.state === "partial" || derived.suppressed.includes("partial");

  if (derived.state === "loading") {
    // Lists reserve their rows (static placeholders, no shimmer); everything
    // else is the one standard spinner. Both announce the wait through the
    // status role, so nothing here is silent.
    if (placeholderRows !== undefined) {
      return (
        <div className="async-region async-region--loading async-region--rows">
          <span className="sr-only" role="status">
            {STATE_COPY.loading}
          </span>
          <PlaceholderRows
            count={placeholderRows}
            group={placeholderGroup === true}
          />
        </div>
      );
    }
    return (
      <div className="async-region async-region--loading">
        <Spinner label={STATE_COPY.loading} />
        <p className="async-region-hint">{STATE_COPY.loading}</p>
      </div>
    );
  }

  if (derived.state === "error") {
    return (
      <div className="async-region async-region--error" role="alert">
        <svg className="icon icon-xl" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-alert-circle" />
        </svg>
        <p className="async-region-hint">
          {errorCopy ?? resolveErrorCopy(derived.error)}
        </p>
        {onRetry !== undefined && (
          <div className="async-region-actions">
            {remainingMs !== undefined && remainingMs > 0 && (
              <span className="feedback-countdown">
                {formatRetryCountdown(remainingMs)}
              </span>
            )}
            <RetryAction
              onRetry={onRetry}
              disabled={rateLimited}
              label={retryLabel}
            />
          </div>
        )}
      </div>
    );
  }

  if (derived.state === "empty") {
    // The content-unavailable pattern (SYSTEM.md): a fitting glyph, a headline
    // naming what is missing, one guidance line, then the action. No dashed box.
    // A region with its own copy names the headline itself; a region without one
    // falls back to the canonical line, which then IS the headline.
    const title =
      emptyTitle ?? (emptyCopy === undefined ? STATE_COPY.empty : undefined);
    const hint = emptyCopy;
    return (
      <div className="async-region async-region--empty" role="status">
        <svg className="icon icon-xl" aria-hidden="true">
          <use href={`/assets/icons/sprite.svg#${emptyIcon}`} />
        </svg>
        {title !== undefined && <p className="async-region-title">{title}</p>}
        {hint !== undefined && <p className="async-region-hint">{hint}</p>}
        {emptyAction !== undefined && (
          <div className="async-region-actions">{emptyAction}</div>
        )}
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
          <Badge className="async-region-stale-badge" tone="neutral">
            {STATE_COPY.stale}
          </Badge>
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
