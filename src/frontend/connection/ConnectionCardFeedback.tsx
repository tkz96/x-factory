// src/frontend/connection/ConnectionCardFeedback.tsx — Status banners and field feedback for ConnectionCard.

import type { ProjectConnectionRole } from "../../shared/types.js";
import { CONNECTIONS_COPY } from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import { FieldFeedback } from "../components/feedback/FieldFeedback.js";
import { ConnectionDegradedBanner } from "./ConnectionDegradedBanner.js";
import { ConnectionErrorBanner } from "./ConnectionErrorBanner.js";
import { splitWarnings } from "./deferred-checks.js";
import type { VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionCardFeedbackProps {
  connectionRole: ProjectConnectionRole;
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
  connectionRole: ProjectConnectionRole;
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

/**
 * The one calm line for checks the provider cannot make before first use. It is
 * information, not a warning, and offers no retry: retrying cannot change it.
 */
function DeferredCheckNote({
  verificationResult,
}: {
  verificationResult?: VerificationResult | null | undefined;
}) {
  const { deferred } = splitWarnings(verificationResult?.warnings ?? []);
  if (deferred.length === 0) return null;
  return (
    <p className="connection-deferred-note text-footnote">
      {CONNECTIONS_COPY.deferredCheckNote}
    </p>
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
        <DeferredCheckNote verificationResult={verificationResult} />
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
        <DeferredCheckNote verificationResult={verificationResult} />
        {isOverPrivileged && (
          <OverPrivilegedNotice connectionRole={connectionRole} />
        )}
      </div>
    );
  }

  return null;
}
