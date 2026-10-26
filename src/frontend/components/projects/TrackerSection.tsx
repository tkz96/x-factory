// src/frontend/components/projects/TrackerSection.tsx — The tracker connection
// card on the project detail surface (XFM-48; rebuilt in #147).
//
// Nothing here branches on a provider id. The card renders the tracker slot of
// the project's connection integrity: the manifest display name, the recorded
// configuration (labels from the manifest, secrets never rendered), the
// degraded warnings, and — when the connection declares the capability — the
// scope-verification diagnostic. A project with no tracker renders the
// integrity failure with its repair path instead (spec #133 story 49).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "../../../shared/types.js";
import { useConnectionLine } from "../../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../../hooks/useProviderDescriptors.js";
import { api } from "../../lib/api-client.js";
import { ConnectionComboLine } from "../connections/ConnectionComboLine.js";
import { comboTone } from "../connections/connection-state.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import {
  CONNECTIONS_COPY,
  formatRetryCountdown,
  resolveErrorCopy,
  unwrapNormalizedError,
} from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import type { DerivedAsyncState } from "../feedback/types.js";
import { useRetryCountdown } from "../feedback/use-retry-countdown.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { formatConnectionWarnings } from "./connection-copy.js";
import {
  applyConnectionIntegrity,
  comboSlots,
  connectionDisplayValues,
  deriveConnectionIntegrity,
  REQUIRED_POST_CREATION_ROLES,
  recordedConnectionIdentityTargets,
  resolveProviderLabel,
} from "./connection-integrity.js";
import "./TrackerSection.css";

interface TrackerSectionProps {
  project: Project;
}

/** The region has no asynchronous condition of its own — the integrity is the state. */
const READY_DERIVED: DerivedAsyncState = {
  state: "ready",
  suppressed: [],
  error: undefined,
};

interface ScopeTestResult {
  ok: boolean;
  overPrivileged?: boolean | undefined;
  error?: unknown;
}

export function TrackerSection({ project }: TrackerSectionProps) {
  const navigate = useNavigate();
  const { data: descriptors = [] } = useProviderDescriptors();
  const integrity = deriveConnectionIntegrity(project, descriptors);
  const tracker = integrity.tracker;

  // The provider's own identity for this connection (#133 story 34), read from
  // the configuration the project RECORDED. The wiring happens before any early
  // return, and only the tracker role is read for.
  const slots = useConnectionLine(
    comboSlots(integrity),
    recordedConnectionIdentityTargets(integrity, ["tracker"], descriptors),
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ScopeTestResult | null>(null);
  const testNormalized = unwrapNormalizedError(testResult?.error);
  const remainingMs = useRetryCountdown(testNormalized?.retryAfterMs);

  if (integrity.hasIntegrityFailure) {
    return (
      <Card id="project-tracker-section" className="project-tracker">
        <div className="tracker-section-header">
          <div>
            <h3 className="tracker-title text-headline">
              {CONNECTIONS_COPY.integrityFailure.title}
            </h3>
            <p className="text-muted tracker-subtitle text-callout">
              {CONNECTIONS_COPY.trackerCardSubtitle}
            </p>
          </div>
        </div>
        <AsyncRegion
          derived={applyConnectionIntegrity(READY_DERIVED, integrity)}
          errorCopy={CONNECTIONS_COPY.integrityFailure.message}
          retryLabel={CONNECTIONS_COPY.reconnect}
          onRetry={() => navigate("/settings")}
        />
      </Card>
    );
  }

  const providerLabel = tracker.providerId
    ? resolveProviderLabel(tracker.providerId, descriptors)
    : CONNECTIONS_COPY.notRecorded;

  const canVerifyScopes = tracker.capabilities.includes("verifyScopes");

  // The action is gated on the connection's DECLARED CAPABILITY, never on a
  // provider id: a provider that adds `verifyScopes` gets the action with no
  // change here. The call is the canonical project-scoped tracker action, which
  // probes the project's STORED connection (#183).
  const handleVerifyScopes = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.verifyProjectScopes(project.id);
      setTestResult({ ok: res.ok, overPrivileged: res.overPrivileged });
    } catch (err) {
      setTestResult({ ok: false, error: err });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card id="project-tracker-section" className="project-tracker">
      <div className="tracker-section-header">
        <div>
          <h3 className="tracker-title text-headline">
            {CONNECTIONS_COPY.trackerCardTitle}
          </h3>
          <p className="text-muted tracker-subtitle text-callout">
            {CONNECTIONS_COPY.trackerCardSubtitle}
          </p>
        </div>
        <Badge>{providerLabel}</Badge>
      </div>

      <ConnectionComboLine
        slots={slots}
        tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
        descriptors={descriptors}
        roles={["tracker"]}
      />

      {tracker.warnings.length > 0 && (
        <FeedbackBanner
          tone="warning"
          message={CONNECTIONS_COPY.degradedTitle}
          items={formatConnectionWarnings(tracker.warnings)}
        />
      )}

      <div className="project-detail-meta-grid">
        {connectionDisplayValues(tracker, descriptors).map((entry) => (
          <div className="project-meta-item" key={entry.name}>
            <strong className="text-subhead">{entry.label}</strong>
            <span className="meta-val text-body">{entry.value}</span>
          </div>
        ))}
        <div className="project-meta-item">
          <strong className="text-subhead">
            {CONNECTIONS_COPY.ingestionLabel}
          </strong>
          <code className="text-body">{CONNECTIONS_COPY.workflowLabel}</code>
        </div>
      </div>

      {canVerifyScopes && (
        <div className="tracker-test-container">
          <Button
            variant="secondary"
            size="sm"
            isDisabled={
              testing || (remainingMs !== undefined && remainingMs > 0)
            }
            onPress={handleVerifyScopes}
          >
            {testing
              ? CONNECTIONS_COPY.verifyScopesPending
              : CONNECTIONS_COPY.verifyScopes}
          </Button>

          {testResult && (
            <FeedbackBanner
              tone={testResult.ok ? "info" : "error"}
              message={
                <strong>
                  {testResult.ok
                    ? CONNECTIONS_COPY.verifyScopesOk
                    : testResult.error
                      ? resolveErrorCopy(testResult.error)
                      : CONNECTIONS_COPY.verifyScopesFailed}
                </strong>
              }
            >
              {!testResult.ok &&
                remainingMs !== undefined &&
                remainingMs > 0 && (
                  <div className="feedback-countdown text-caption-1">
                    {formatRetryCountdown(remainingMs)}
                  </div>
                )}
              {testResult.overPrivileged && (
                <div className="tracker-overprivileged-notice text-callout">
                  {CONNECTIONS_COPY.overPrivileged}
                </div>
              )}
            </FeedbackBanner>
          )}
        </div>
      )}
    </Card>
  );
}
