// src/frontend/connection/ConnectionCardFeedback.tsx — Status banners and field feedback for ConnectionCard.

import { CONNECTIONS_COPY } from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
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

export function OverPrivilegedNotice({
  connectionRole,
}: {
  connectionRole: "tracker" | "gitHost";
}) {
  return (
    <div
      className="connection-overprivileged-container"
      id={`${connectionRole}-overprivileged-notice`}
    >
      <FeedbackBanner
        tone="warning"
        message={CONNECTIONS_COPY.overPrivileged}
      />
    </div>
  );
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

  const isOverPrivileged = Boolean(verificationResult?.overPrivileged);

  if (verificationStatus === "degraded") {
    return (
      <div className="connection-feedback-group">
        <ConnectionDegradedBanner
          verificationResult={verificationResult}
          onRetry={onVerify}
        />
        {isOverPrivileged && (
          <OverPrivilegedNotice connectionRole={connectionRole} />
        )}
      </div>
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
      <div className="connection-feedback-group">
        <FieldFeedback
          state="valid"
          message={CONNECTIONS_COPY.verified}
          id={`${connectionRole}-verified-feedback`}
        />
        {isOverPrivileged && (
          <OverPrivilegedNotice connectionRole={connectionRole} />
        )}
      </div>
    );
  }

  return null;
}
