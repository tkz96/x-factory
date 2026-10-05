// src/frontend/components/connections/ComboSummary.tsx — The one connection
// combo line (spec #133, ticket #146).
//
// Presentation only: it is handed a providers manifest and the verification
// evidence for the two connection roles, and it renders a human display name
// plus one of three health states per role. It reads no wizard state and holds
// no provider knowledge, so every surface that shows a project's connections
// renders the same line — and adding a provider needs no change here.

import type { ProviderDescriptor } from "../../connection/types.js";
import { CONNECTION_STATE_COPY } from "../feedback/copy-map.js";
import {
  type ConnectionEvidence,
  type ConnectionState,
  deriveConnectionState,
} from "./connection-state.js";
import "./ComboSummary.css";

export interface ComboSummaryProps {
  /** The providers manifest — THE source of human display names. */
  manifest: readonly ProviderDescriptor[];
  tracker: ConnectionEvidence;
  gitHost: ConnectionEvidence;
  /** Overrides the container id when a surface needs its own anchor. */
  id?: string;
}

/**
 * Resolves the user-facing name of a provider from the manifest descriptor.
 * Falls back to the id ONLY when the manifest has not loaded (or does not
 * describe the id) — there is no id → name table anywhere, and no provider
 * name is ever invented.
 */
function displayNameOf(
  manifest: readonly ProviderDescriptor[],
  providerId: string,
): string {
  return manifest.find((p) => p.id === providerId)?.displayName ?? providerId;
}

function stateCopy(
  evidence: ConnectionEvidence,
  state: ConnectionState,
): string {
  if (state === "connected") return CONNECTION_STATE_COPY.connected;
  if (state === "disconnected") return CONNECTION_STATE_COPY.disconnected;
  return evidence.degradedAccepted === true
    ? CONNECTION_STATE_COPY.degradedAccepted
    : CONNECTION_STATE_COPY.degraded;
}

function ComboRole({
  connectionRole,
  label,
  manifest,
  evidence,
}: {
  connectionRole: "tracker" | "gitHost";
  label: string;
  manifest: readonly ProviderDescriptor[];
  evidence: ConnectionEvidence;
}) {
  const state = deriveConnectionState(evidence);
  const name =
    state === "disconnected" || evidence.providerId === null
      ? CONNECTION_STATE_COPY.disconnected
      : displayNameOf(manifest, evidence.providerId);

  return (
    <span className="combo-summary-role" id={`combo-${connectionRole}`}>
      <span className="combo-summary-label">{label}</span>
      <span className="combo-summary-value" id={`combo-${connectionRole}-name`}>
        {name}
      </span>
      <span
        className={`combo-summary-state combo-summary-state--${state}`}
        id={`combo-${connectionRole}-state`}
        data-connection-state={state}
      >
        {stateCopy(evidence, state)}
      </span>
    </span>
  );
}

export function ComboSummary({
  manifest,
  tracker,
  gitHost,
  id = "combo-summary",
}: ComboSummaryProps) {
  return (
    <div className="combo-summary-container" id={id}>
      <ComboRole
        connectionRole="tracker"
        label={CONNECTION_STATE_COPY.trackerLabel}
        manifest={manifest}
        evidence={tracker}
      />
      <span className="combo-summary-separator" aria-hidden="true">
        ·
      </span>
      <ComboRole
        connectionRole="gitHost"
        label={CONNECTION_STATE_COPY.gitHostLabel}
        manifest={manifest}
        evidence={gitHost}
      />
    </div>
  );
}
