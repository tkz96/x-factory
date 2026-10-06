// src/frontend/connection/ConnectionCardFeedback.tsx — Status banners and field feedback for ConnectionCard.

import { FieldFeedback } from "../components/feedback/FieldFeedback.js";
import { ConnectionDegradedBanner } from "./ConnectionDegradedBanner.js";
import { ConnectionErrorBanner } from "./ConnectionErrorBanner.js";
import type { VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionCardFeedbackProps {
  connectionRole: "tracker" | "gitHost";
  verificationStatus: "idle" | "pending" | "ok" | "degraded" | "error";
  verificationResult?: VerificationResult | null | undefined;
  verificationError?: unknown | null | undefined;
  hasFormErrors: boolean;
  hasFieldErrors: boolean;
  formErrors?: string[] | null | undefined;
  onVerify: () => void;
}

export function ConnectionCardFeedback({
  connectionRole,
  verificationStatus,
  verificationResult,
  verificationError,
  hasFormErrors,
  hasFieldErrors,
  formErrors,
  onVerify,
}: ConnectionCardFeedbackProps) {
  if (hasFormErrors && formErrors) {
    return <ConnectionErrorBanner formErrors={formErrors} onRetry={onVerify} />;
  }

  if (verificationStatus === "degraded") {
    return (
      <ConnectionDegradedBanner
        verificationResult={verificationResult}
        onRetry={onVerify}
      />
    );
  }

  if (verificationStatus === "error" && !hasFieldErrors) {
    return (
      <ConnectionErrorBanner
        verificationError={verificationError}
        onRetry={onVerify}
      />
    );
  }

  if (verificationStatus === "ok") {
    return (
      <FieldFeedback
        state="valid"
        message="Connection verified"
        id={`${connectionRole}-verified-feedback`}
      />
    );
  }

  return null;
}
