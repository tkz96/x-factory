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
import { useConnectionIdentities } from "../../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../../hooks/useProviderDescriptors.js";
import { api } from "../../lib/api-client.js";
import { ConnectionComboLine } from "../connections/ConnectionComboLine.js";
import {
  comboTone,
  identitiesByRole,
  withConnectionIdentities,
} from "../connections/connection-state.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { CONNECTIONS_COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import type { DerivedAsyncState } from "../feedback/types.js";
import { formatConnectionWarnings } from "./connection-copy.js";
import {
  applyConnectionIntegrity,
  comboSlots,
  connectionDisplayValues,
  connectionIdentityTargets,
  deriveConnectionIntegrity,
  REQUIRED_CONNECTION_ROLES,
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
}

export function TrackerSection({ project }: TrackerSectionProps) {
  const navigate = useNavigate();
  const { data: descriptors = [] } = useProviderDescriptors();
  const integrity = deriveConnectionIntegrity(project, descriptors);
  const tracker = integrity.tracker;

  // The provider's own identity for this connection (#133 story 34), read from
  // the configuration the project RECORDED. The hook is called before any early
  // return, and the line below renders only the tracker role.
  const identityTargets = connectionIdentityTargets(integrity, ["tracker"]);
  const identityLookup = useConnectionIdentities(identityTargets);
  const slots = withConnectionIdentities(
    comboSlots(integrity),
    identitiesByRole(identityTargets, identityLookup),
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ScopeTestResult | null>(null);

  if (integrity.hasIntegrityFailure) {
    return (
      <div id="project-tracker-section" className="project-tracker-card card">
        <div className="tracker-section-header">
          <div>
            <h3 className="tracker-title">
              {CONNECTIONS_COPY.integrityFailure.title}
            </h3>
            <p className="text-muted tracker-subtitle">
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
      </div>
    );
  }

  const providerLabel = tracker.providerId
    ? resolveProviderLabel(tracker.providerId, descriptors)
    : CONNECTIONS_COPY.notRecorded;

  const canVerifyScopes = tracker.capabilities.includes("verifyScopes");

  // The action is gated on the connection's DECLARED CAPABILITY, never on a
  // provider id: a provider that adds `verifyScopes` gets the action with no
  // change here. The wire route behind the call is provider-named (a recorded
  // #141-era limitation — see docs/reference/state-coverage.md).
  const handleVerifyScopes = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testAzureScopes({ projectId: project.id });
      setTestResult({ ok: res.ok, overPrivileged: res.overPrivileged });
    } catch {
      setTestResult({ ok: false });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div id="project-tracker-section" className="project-tracker-card card">
      <div className="tracker-section-header">
        <div>
          <h3 className="tracker-title">{CONNECTIONS_COPY.trackerCardTitle}</h3>
          <p className="text-muted tracker-subtitle">
            {CONNECTIONS_COPY.trackerCardSubtitle}
          </p>
        </div>
        <span className="role-badge">{providerLabel}</span>
      </div>

      <ConnectionComboLine
        slots={slots}
        tone={comboTone(slots, REQUIRED_CONNECTION_ROLES)}
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
            <strong>{entry.label}</strong>
            <span>{entry.value}</span>
          </div>
        ))}
        <div className="project-meta-item">
          <strong>{CONNECTIONS_COPY.ingestionLabel}</strong>
          <code>{CONNECTIONS_COPY.workflowLabel}</code>
        </div>
      </div>

      {canVerifyScopes && (
        <div className="tracker-test-container">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleVerifyScopes}
            disabled={testing}
          >
            {testing
              ? CONNECTIONS_COPY.verifyScopesPending
              : CONNECTIONS_COPY.verifyScopes}
          </button>

          {testResult && (
            <div
              className={`tracker-test-result ${
                testResult.ok ? "success" : "danger"
              }`}
              role="status"
            >
              <strong>
                {testResult.ok
                  ? CONNECTIONS_COPY.verifyScopesOk
                  : CONNECTIONS_COPY.verifyScopesFailed}
              </strong>
              {testResult.overPrivileged && (
                <div className="tracker-overprivileged-notice">
                  {CONNECTIONS_COPY.overPrivileged}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
