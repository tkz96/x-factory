// src/frontend/connection/ConnectionDegradedBanner.tsx — The PARTIAL state of a
// degraded-but-verified connection (#133: "degraded renders the partial state,
// never blocks progression").
//
// The warnings are the whole surface: which capabilities could not be
// confirmed, and a retry. There is deliberately no acknowledgement to collect —
// a degraded verification is usable, so an "accept" step would gate nothing.

import {
  CONNECTIONS_COPY,
  DEGRADED_CAPABILITY_COPY,
  DEGRADED_CAPABILITY_FALLBACK,
} from "../components/feedback/copy-map.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import { formatDegradedCapabilityNotice } from "./scope-feedback.js";
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
  const warnings = verificationResult?.warnings ?? [];
  const items = warnings
    .filter((w) => w.kind === "CAPABILITY_UNCONFIRMED")
    .map((w) => formatDegradedCapabilityNotice(w.capability, w.missingScopes));

  const remediations = Array.from(
    new Set(
      warnings
        .filter((w) => w.kind === "CAPABILITY_UNCONFIRMED")
        .map((w) => {
          if (w.missingScopes && w.missingScopes.length > 0) {
            return CONNECTIONS_COPY.degradedRemediation;
          }
          const entry = DEGRADED_CAPABILITY_COPY[w.capability];
          return entry?.remediation ?? DEGRADED_CAPABILITY_FALLBACK.remediation;
        }),
    ),
  );

  return (
    <div className="connection-degraded-container">
      <FeedbackBanner
        tone="warning"
        message={CONNECTIONS_COPY.degradedLead}
        items={items}
        onRetry={onRetry}
      />
      {remediations.map((text) => (
        <p key={text} className="connection-degraded-remediation">
          {text}
        </p>
      ))}
    </div>
  );
}
