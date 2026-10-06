// src/frontend/components/connections/connection-state.ts — The one definition
// of a connection's health (spec #133, ticket #146).
//
// Every surface that reports on a connection — the wizard's Review combo line,
// the post-creation project surfaces (#147) and the Review gate — reads these
// predicates, so the line a user sees and the gate that blocks them can never
// disagree about whether a connection is usable.
//
// Provider-agnostic: this module knows a connection's *evidence* (provider id,
// verification outcome, unconfirmed capabilities), never a provider.
//
// A DEGRADED connection is USABLE. #133 is explicit and repeated: "degraded →
// the partial state (warning banner on the card), progression never blocked",
// "degraded renders the partial state, never blocks", and story 19 "show a
// warning on the card but never block progression" (line 125, line 136). The
// warnings stay VISIBLE; they are never an acknowledgement to collect.

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
  /** Capabilities the verification could not confirm (degraded evidence). */
  unconfirmedCapabilities?: readonly string[] | undefined;
}

/**
 * `connected` — verified with nothing outstanding.
 * `degraded` — verified, but with warnings.
 * `disconnected` — no provider selected, or not verified in this session. A
 * restored draft always lands here: verification results are never persisted.
 */
export function deriveConnectionState(
  evidence: ConnectionEvidence,
): ConnectionState {
  if (evidence.providerId === null || evidence.verified !== true) {
    return "disconnected";
  }
  return (evidence.unconfirmedCapabilities?.length ?? 0) > 0
    ? "degraded"
    : "connected";
}

/**
 * True when a project may be created with this connection: verified. A degraded
 * verification IS usable — its warnings are surfaced, never a gate — and only a
 * fresh verification can turn an unverified connection usable, so there is no
 * dismissal or skip path.
 */
export function isConnectionUsable(evidence: ConnectionEvidence): boolean {
  return deriveConnectionState(evidence) !== "disconnected";
}

// ---------------------------------------------------------------------------
// The combo line's model — one shape, two producers
// ---------------------------------------------------------------------------

/** The line's tone. The worst slot decides it; warnings are never the error tone. */
export type ConnectionComboTone = "connected" | "warning" | "error";

/**
 * One role's slot as the combo line renders it: which provider serves the role,
 * and in which of the three states.
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
  /**
   * The connection's provider-owned identity, as the provider describes its own
   * configuration (`"owner/repo"`, `"acme.atlassian.net/ROCK"`) — presentation
   * metadata the line renders as `displayName (identity)` (#133 story 34).
   *
   * Absent or null whenever there is no identity to show: the provider does not
   * declare the capability, the configuration identifies nothing yet, or the
   * surface cannot reach the configuration at all (a legacy project). The line
   * then renders the plain display name, so an unavailable identity is never an
   * error and never the text "null".
   */
  readonly identity?: string | null | undefined;
}

/** One connection whose identity a surface wants: role, provider, configuration. */
export interface ConnectionIdentityTarget {
  readonly role: ProjectConnectionRole;
  readonly providerId: string | null;
  /**
   * The connection's SECRET-FREE configuration, and nothing else (#133
   * correction 1).
   *
   * The identity read is a presentation-only surface: the server composes
   * `"owner/repo"` from coordinates that are never credentials, and a request
   * that carries a declared secret value is refused. Producers therefore build
   * this through `identityConfig`, which keeps only the fields the manifest
   * declares and drops every field it declares `secret` — so the credentials a
   * user typed are not what travels here, whatever the draft or the record
   * happens to hold.
   */
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * A connection configuration as the identity read may carry it: the fields the
 * manifest declares for the provider, minus every field declared `secret`.
 *
 * Deny by default. A provider the manifest does not declare yields `{}` — the
 * manifest is the presentation contract, and sending a configuration whose
 * secret fields are unknown is exactly the request the route refuses. The
 * identity then simply stays unavailable, and the line renders the plain display
 * name, which is what an unloaded manifest must look like.
 */
export function identityConfig(
  providerId: string | null,
  config: Readonly<Record<string, unknown>>,
  descriptors: readonly ProviderDescriptor[],
): Record<string, unknown> {
  const descriptor = descriptors.find((entry) => entry.id === providerId);
  if (!descriptor) {
    return {};
  }
  const allowed = new Set(
    descriptor.configFields
      .filter((field) => field.secret !== true)
      .map((field) => field.name),
  );
  return Object.fromEntries(
    Object.entries(config).filter(([name]) => allowed.has(name)),
  );
}

/** The identities a surface has, per role. A role may be absent or null. */
export type ConnectionIdentities = Partial<
  Record<ProjectConnectionRole, string | null>
>;

/**
 * How a surface reaches an identity it has already fetched: given a connection
 * (provider + configuration), the provider's identity or `null`. The ONE
 * identity hook produces one of these; nothing else may invent one.
 */
export type ConnectionIdentityLookup = (
  target: ConnectionIdentityTarget,
) => string | null;

/**
 * One role's identity from a lookup: `null` for a connection the lookup has
 * nothing for — a provider that declares no `describeConnection` capability, a
 * configuration that identifies nothing, or a read that has not resolved yet.
 * All three render the same way (the plain display name), which is why they are
 * one value rather than three states.
 */
export function identitiesByRole(
  targets: readonly ConnectionIdentityTarget[],
  lookup: ConnectionIdentityLookup,
): ConnectionIdentities {
  const identities: Partial<Record<ProjectConnectionRole, string | null>> = {};
  for (const target of targets) {
    identities[target.role] = lookup(target);
  }
  return identities;
}

/**
 * The line's slots with the identities a surface has, per role. This is the ONE
 * place identity is attached to a slot, so both producers reach the rendering
 * the same way: a role with no identity keeps the slot it already had.
 */
export function withConnectionIdentities(
  slots: readonly ConnectionComboSlot[],
  identities: ConnectionIdentities | undefined,
): ConnectionComboSlot[] {
  if (identities === undefined) {
    return [...slots];
  }
  return slots.map((slot) => {
    const identity = identities[slot.role];
    return identity === undefined ? slot : { ...slot, identity };
  });
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
  };
}

/** What the tone rule needs of a slot: its role, and its state. */
export type ComboToneSlot = Pick<ConnectionComboSlot, "role" | "state">;

/**
 * The line's tone — THE rule, for every producer (#148: one combo line, one
 * vocabulary). The worst slot decides it, and a warning never takes the error
 * tone.
 *
 * `requiredRoles` is the ONE producer-specific input, and it is a statement
 * about the LINE, not about a provider: a slot with no connection is the error
 * tone when the line requires that role and a warning otherwise. The wizard's
 * Review line gates creation on both roles (#133: both connections are
 * mandatory), while on a persisted project an absent git host is a pre-#145
 * project's recorded-as-missing wiring — surfaced, never invented.
 */
export function comboTone(
  slots: readonly ComboToneSlot[],
  requiredRoles: readonly ProjectConnectionRole[],
): ConnectionComboTone {
  const isError = slots.some(
    (slot) =>
      slot.state === "disconnected" && requiredRoles.includes(slot.role),
  );
  if (isError) return "error";

  const isWarning = slots.some(
    (slot) => slot.state === "degraded" || slot.state === "disconnected",
  );
  return isWarning ? "warning" : "connected";
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
