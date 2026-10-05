// src/frontend/components/connections/connection-state.ts — The one definition
// of a connection's health (spec #133, ticket #146).
//
// Every surface that reports on a connection — the wizard's combo summary line
// today, the post-creation project surfaces (#147) and the Review gate — reads
// these predicates, so the line a user sees and the gate that blocks them can
// never disagree about whether a connection is usable.
//
// Provider-agnostic: this module knows a connection's *evidence* (provider id,
// verification outcome, accepted warnings), never a provider.

/** The three states a connection line can render, per role. */
export type ConnectionState = "connected" | "degraded" | "disconnected";

/**
 * The verification evidence for one connection role. Structurally satisfied by
 * `WizardConnectionRoleState`; re-declared here so any surface can report a
 * connection without depending on the wizard's state module.
 */
export interface ConnectionEvidence {
  providerId: string | null;
  /** Set by the verification call: the credentials were accepted. */
  verified?: boolean | undefined;
  /** The user explicitly accepted the degraded result's warnings. */
  degradedAccepted?: boolean | undefined;
  /** Capabilities the verification could not confirm (degraded evidence). */
  unconfirmedCapabilities?: readonly string[] | undefined;
}

/**
 * `connected` — verified with nothing outstanding.
 * `degraded` — verified, but with warnings (accepted or not).
 * `disconnected` — no provider selected, or not verified in this session. A
 * restored draft always lands here: verification results are never persisted.
 */
export function deriveConnectionState(
  evidence: ConnectionEvidence,
): ConnectionState {
  if (evidence.providerId === null || evidence.verified !== true) {
    return "disconnected";
  }
  const hasWarnings =
    evidence.degradedAccepted === true ||
    (evidence.unconfirmedCapabilities?.length ?? 0) > 0;
  return hasWarnings ? "degraded" : "connected";
}

/**
 * True when a project may be created with this connection: fully connected, or
 * degraded WITH the warnings explicitly accepted. Never a dismissal — only a
 * fresh verification (or an explicit acceptance of real evidence) can make it
 * true.
 */
export function isConnectionUsable(evidence: ConnectionEvidence): boolean {
  const state = deriveConnectionState(evidence);
  return (
    state === "connected" || (state === "degraded" && evidence.degradedAccepted)
  );
}
