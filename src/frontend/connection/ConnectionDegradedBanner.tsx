// src/frontend/connection/ConnectionDegradedBanner.tsx — The PARTIAL state of a
// degraded-but-verified connection (#133: "degraded renders the partial state,
// never blocks progression").
//
// The warnings are the whole surface: which capabilities could not be
// confirmed, and a retry. There is deliberately no acknowledgement to collect —
// a degraded verification is usable, so an "accept" step would gate nothing.

import { STATE_COPY } from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import type { VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionDegradedBannerProps {
  verificationResult?: VerificationResult | null | undefined;
  onRetry: () => void;
}

export function ConnectionDegradedBanner({
  verificationResult,
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
    </div>
  );
}
