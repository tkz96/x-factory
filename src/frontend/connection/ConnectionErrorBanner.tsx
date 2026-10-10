// src/frontend/connection/ConnectionErrorBanner.tsx — Error banner for ConnectionCard.

import {
  resolveErrorCopy,
  resolveFormValidationError,
  unwrapNormalizedError,
} from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import "./ConnectionCard.css";

export interface ConnectionErrorBannerProps {
  formErrors?: string[] | null | undefined;
  verificationError?: unknown | null | undefined;
  onRetry: () => void;
}

export function ConnectionErrorBanner({
  formErrors,
  verificationError,
  onRetry,
}: ConnectionErrorBannerProps) {
  if (formErrors && formErrors.length > 0) {
    return (
      <FeedbackBanner
        tone="error"
        message={formErrors.map(resolveFormValidationError).join(". ")}
        onRetry={onRetry}
      />
    );
  }

  const normalized = unwrapNormalizedError(verificationError);
  const retryAfterMs = normalized?.retryAfterMs;

  return (
    <FeedbackBanner
      tone="error"
      message={resolveErrorCopy(verificationError)}
      retryAfterMs={retryAfterMs}
      onRetry={onRetry}
    />
  );
}
