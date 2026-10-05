// src/frontend/connection/ConnectionDegradedBanner.tsx — Warning banner for degraded connection status with acceptance action.

import { STATE_COPY } from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import type { VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionDegradedBannerProps {
  connectionRole: "tracker" | "gitHost";
  verificationResult?: VerificationResult | null | undefined;
  degradedAccepted?: boolean | undefined;
  onAccept?: (() => void) | undefined;
  onRetry: () => void;
}

export function ConnectionDegradedBanner({
  connectionRole,
  verificationResult,
  degradedAccepted = false,
  onAccept,
  onRetry,
}: ConnectionDegradedBannerProps) {
  const unconfirmedCapabilities = verificationResult?.warnings
    ? verificationResult.warnings
        .filter((w) => w.kind === "CAPABILITY_UNCONFIRMED")
        .map((w) => w.capability)
    : [];

  return (
    <div className="connection-degraded-container">
      <FeedbackBanner
        tone="warning"
        message={STATE_COPY.partial}
        items={unconfirmedCapabilities}
        onRetry={onRetry}
      />
      <div className="connection-degraded-actions">
        <button
          type="button"
          id={`btn-accept-degraded-${connectionRole}`}
          className="btn-secondary btn-sm"
          onClick={onAccept}
          disabled={degradedAccepted}
        >
          {degradedAccepted
            ? "Partial connection accepted"
            : "Accept partial connection"}
        </button>
      </div>
    </div>
  );
}
