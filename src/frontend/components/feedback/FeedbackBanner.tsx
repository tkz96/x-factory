// src/frontend/components/feedback/FeedbackBanner.tsx — Inline banner for
// partial/degraded warnings and rate-limit timed guidance (#135, resolution
// #132). Never a toast: it renders inside its region with `role="status"`
// semantics (spec #133 user story 53). Rate-limited retries stay disabled
// behind countdown guidance that ticks down once per second.

import { formatRetryCountdown } from "./copy-map.js";
import { RetryAction } from "./RetryAction.js";
import { useRetryCountdown } from "./use-retry-countdown.js";
import "./FeedbackBanner.css";

export type FeedbackBannerTone = "info" | "warning" | "error";

const BANNER_ICONS: Readonly<Record<FeedbackBannerTone, string>> = {
  info: "icon-info",
  warning: "icon-alert-circle",
  error: "icon-x-circle",
};

export interface FeedbackBannerProps {
  tone: FeedbackBannerTone;
  /** Canonical copy — the caller resolves it through the copy map. */
  message: string;
  /** Partial regions: the parts that failed, listed inline. */
  items?: readonly string[] | undefined;
  /** Rate-limit timed guidance: the retry stays disabled until it elapses. */
  retryAfterMs?: number | undefined;
  onRetry?: (() => void) | undefined;
}

export function FeedbackBanner({
  tone,
  message,
  items,
  retryAfterMs,
  onRetry,
}: FeedbackBannerProps) {
  const remainingMs = useRetryCountdown(retryAfterMs);
  return (
    <div className={`feedback-banner feedback-banner--${tone}`} role="status">
      <svg className="icon icon-md" aria-hidden="true">
        <use href={`/assets/icons/sprite.svg#${BANNER_ICONS[tone]}`} />
      </svg>
      <div className="feedback-banner-content">
        <p className="feedback-banner-message">{message}</p>
        {items !== undefined && items.length > 0 && (
          <ul className="feedback-banner-items">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      {onRetry !== undefined && (
        <div className="feedback-banner-actions">
          {remainingMs !== undefined && remainingMs > 0 && (
            <span className="feedback-countdown">
              {formatRetryCountdown(remainingMs)}
            </span>
          )}
          <RetryAction
            onRetry={onRetry}
            disabled={remainingMs !== undefined && remainingMs > 0}
          />
        </div>
      )}
    </div>
  );
}
