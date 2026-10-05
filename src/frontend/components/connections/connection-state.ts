// src/frontend/components/connections/connection-state.ts — The one definition
// of a connection's health (spec #133, ticket #146).
//
// Every surface that reports on a connection — the wizard's Review combo line,
// the post-creation project surfaces (#147) and the Review gate — reads these
// predicates, so the line a user sees and the gate that blocks them can never
// disagree about whether a connection is usable.
//
// Provider-agnostic: this module knows a connection's *evidence* (provider id,
// verification outcome, accepted warnings), never a provider.

import type { ProjectConnectionRole } from "../../../shared/types.js";
import type { ProviderDescriptor } from "../../connection/types.js";

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
    state === "connected" ||
    (state === "degraded" && evidence.degradedAccepted === true)
  );
}

// ---------------------------------------------------------------------------
// The combo line's model — one shape, two producers
// ---------------------------------------------------------------------------

/** The line's tone. The worst slot decides it; warnings are never the error tone. */
export type ConnectionComboTone = "connected" | "warning" | "error";

/**
 * One role's slot as the combo line renders it: which provider serves the role,
 * in which of the three states, and — for draft evidence only — whether a
 * degraded result's warnings were explicitly accepted.
 *
 * The wizard produces these from verification evidence
 * (`comboSlotFromEvidence`); the post-creation surfaces produce them from a
 * project's persisted connections (`connection-integrity.ts`). Both feed the
 * SAME presentational component, so the line a user sees during onboarding and
 * the line they see afterwards can never drift apart.
 */
export interface ConnectionComboSlot {
  readonly role: ProjectConnectionRole;
  readonly state: ConnectionState;
  readonly providerId: string | null;
  /** Degraded with the warnings explicitly accepted (draft evidence only). */
  readonly accepted?: boolean | undefined;
}

/** One role's slot, derived from the verification evidence the wizard holds. */
export function comboSlotFromEvidence(
  role: ProjectConnectionRole,
  evidence: ConnectionEvidence,
): ConnectionComboSlot {
  return {
    role,
    state: deriveConnectionState(evidence),
    providerId: evidence.providerId,
    accepted: evidence.degradedAccepted === true,
  };
}

/**
 * The tone of a line built from draft verification evidence: a role that is not
 * connected is the error tone (Review is a gate), a degraded role is the
 * warning tone, and everything else reads as connected.
 */
export function comboEvidenceTone(
  slots: readonly ConnectionComboSlot[],
): ConnectionComboTone {
  if (slots.some((slot) => slot.state === "disconnected")) return "error";
  if (slots.some((slot) => slot.state === "degraded")) return "warning";
  return "connected";
}

/**
 * The human display name for a provider id: the manifest's `displayName`, or
 * the id itself when the manifest has not loaded — never an invented name and
 * never a hardcoded id→name table. The manifest is THE source of names.
 */
export function resolveProviderLabel(
  providerId: string,
  descriptors: readonly ProviderDescriptor[],
): string {
  return (
    descriptors.find((descriptor) => descriptor.id === providerId)
      ?.displayName ?? providerId
  );
}
