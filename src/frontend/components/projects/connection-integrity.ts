// src/frontend/components/projects/connection-integrity.ts — Post-creation
// connection surfacing (spec #133, ticket #147; consolidated by #176).
//
// THE recorded-input adapter of the one connection view
// (`components/connections/connection-view.ts`): a project's normalized
// `connections` payload (#145 / #131) goes through `deriveConnectionView` and
// comes back as the three-state descriptor every post-creation surface renders
// — connected, degraded (warnings present), disconnected — plus the no-tracker
// INTEGRITY FAILURE. Both connections are mandatory at creation (#133 §Wizard
// flow & UX), so "a project with no tracker" is not a supported mode: it is a
// durable configuration error with a repair path.
//
// Provider-agnosticism (spec #133, docs/reference/provider-api.md): this module never branches on a
// provider id. Display names come from the providers manifest, the
// "configuration is incomplete" check is driven by the manifest's own field
// descriptors (`required` + `secret` + `roles`), and the legacy pre-#145
// fallback looks the provider's configuration up by its own id — all of it
// owned by the ONE view module (#176).
//
// LEGACY PROJECTS: a project created before #145 has no `connections` array
// and only an `issueTracker` record. It still renders a combo line: the
// tracker descriptor is derived (display-only) from `issueTracker`, and the
// git host is shown as not recorded rather than invented. A legacy project
// with no usable `issueTracker` is an integrity failure like any other.

import {
  PROJECT_CONNECTION_ROLES,
  type Project,
  type ProjectConnectionRole,
} from "../../../shared/types.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import {
  type ConnectionComboSlot,
  type ConnectionIdentityTarget,
  identityConfig,
  resolveProviderLabel,
} from "../connections/connection-state.js";
import {
  type ConnectionSlot,
  type ConnectionWarning,
  connectionComboSlots,
  deriveConnectionView,
  descriptorFor,
  fieldsForRole,
  slotsForRoles,
} from "../connections/connection-view.js";
import type { DerivedAsyncState } from "../feedback/types.js";

/** The whole project's wiring, as derived for display. */
export interface ConnectionIntegrity {
  /** Always tracker first, then git host. */
  readonly slots: readonly ConnectionSlot[];
  readonly tracker: ConnectionSlot;
  readonly gitHost: ConnectionSlot;
  /** No connection serves the `tracker` role — the integrity failure. */
  readonly hasIntegrityFailure: boolean;
  /** Warnings present and no integrity failure — warning tone, never error. */
  readonly isDegraded: boolean;
  readonly warnings: readonly ConnectionWarning[];
}

/**
 * Derives the whole project's connection wiring for display. Pure: the same
 * project and manifest always produce the same integrity.
 *
 * The RECORDED half of the ONE connection view (#176): `deriveConnectionView`
 * owns the slots — one per role of THE list, each built for its own role — and
 * this adapter folds them into the integrity shape the post-creation surfaces
 * read, in the line's render order: tracker first, then git host.
 */
export function deriveConnectionIntegrity(
  project: Project,
  descriptors: readonly ProviderDescriptor[] = [],
): ConnectionIntegrity {
  const view = deriveConnectionView({ kind: "recorded", project }, descriptors);
  // THE list's order is the render order: tracker first, then git host.
  const slots = PROJECT_CONNECTION_ROLES.map((role) => view[role]);
  const warnings = slots.flatMap((slot) => slot.warnings);
  const hasIntegrityFailure = view.tracker.state === "disconnected";

  return {
    slots,
    tracker: view.tracker,
    gitHost: view.gitHost,
    hasIntegrityFailure,
    isDegraded: !hasIntegrityFailure && warnings.length > 0,
    warnings,
  };
}

/**
 * The combo line's slots for a derived integrity: tracker first, then git host,
 * restricted to `roles` when the surface renders a single role.
 *
 * The recorded producer of the ONE combo-line model (#148/#176) — the wizard's
 * Review step reaches the same shape from draft verification evidence through
 * the same mapping (`connectionComboSlots`), and both render
 * `ConnectionComboLine`.
 */
export function comboSlots(
  integrity: ConnectionIntegrity,
  roles?: readonly ProjectConnectionRole[],
): ConnectionComboSlot[] {
  return connectionComboSlots(integrity.slots, roles);
}

/**
 * The connections a post-creation surface asks for identities: one target per
 * slot, carrying the provider id and the configuration a project RECORDED for
 * that role — its NON-SECRET fields only, projected through the manifest
 * (`identityConfig`, #133 correction 1).
 *
 * Named for what it reads, because the wizard has its own target producer for
 * the DRAFT configuration (`connectConfig.draftConnectionIdentityTargets`): both
 * answer "what shall be described?", from different sources, and one name for
 * both made a call site read as if it were the other.
 *
 * A role a project never recorded (a legacy project's git host) yields a target
 * with no provider id, which the identity hook does not query — the slot simply
 * renders without an identity. Presentation metadata only: nothing here is
 * persisted, and the target is handed to the ONE identity hook
 * (`useConnectionIdentities`) by every post-creation surface.
 */
export function recordedConnectionIdentityTargets(
  integrity: ConnectionIntegrity,
  roles: readonly ProjectConnectionRole[] | undefined,
  descriptors: readonly ProviderDescriptor[],
): ConnectionIdentityTarget[] {
  return slotsForRoles(integrity.slots, roles).map((slot) => ({
    role: slot.role,
    providerId: slot.providerId ?? null,
    config: identityConfig(slot.providerId ?? null, slot.config, descriptors),
  }));
}

/**
 * The roles a POST-CREATION line requires. A project with no tracker is the
 * integrity failure (#133: both connections are mandatory at creation); an
 * absent git host is a pre-#145 project's recorded-as-missing wiring, which is
 * surfaced as a warning rather than invented.
 *
 * This is deliberately NOT `PROJECT_CONNECTION_ROLES` (the two-role list every
 * other surface reads): it is a one-role requirement, and it is declared
 * `satisfies ProjectConnectionRole` so a role renamed in the shared type breaks
 * this list at compile time rather than silently reporting nothing.
 *
 * Surfaces pass this to the ONE tone rule with their line's slots
 * (`comboTone(comboSlots(integrity), REQUIRED_CONNECTION_ROLES)`); there is no
 * second implementation of the rule here.
 */
export const REQUIRED_CONNECTION_ROLES = [
  "tracker",
] as const satisfies readonly ProjectConnectionRole[];

/**
 * The human display name for a provider id: the manifest's `displayName`, or
 * the id itself when the manifest has not loaded — never an invented name and
 * never a hardcoded id→name table. Re-exported here because the post-creation
 * surfaces reach for it while rendering a project's connections.
 */
export { resolveProviderLabel };

/**
 * Promotes an integrity failure into the region state.
 *
 * The integrity failure is not an asynchronous condition — it is a durable
 * configuration error, so it is primary over every derived state. The
 * underlying derivation is preserved in `suppressed` (minus `ready`, which is
 * not a diagnostic) so a diagnostic is never silently dropped.
 */
export function applyConnectionIntegrity(
  derived: DerivedAsyncState,
  integrity: ConnectionIntegrity | undefined,
): DerivedAsyncState {
  if (!integrity?.hasIntegrityFailure) {
    return derived;
  }

  const suppressed = [derived.state, ...derived.suppressed].filter(
    (state) => state !== "error" && state !== "ready",
  );

  return {
    state: "error",
    suppressed: [...new Set(suppressed)],
    error: derived.error,
  };
}

/** One recorded configuration value, ready to render. */
export interface ConnectionDisplayValue {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}

/**
 * The connection's recorded configuration as display rows, using the
 * manifest's field labels. Secret fields are never rendered (their values are
 * never persisted — #131), and configuration keys the manifest does not
 * declare are not rendered either: the manifest is the presentation contract.
 */
export function connectionDisplayValues(
  slot: ConnectionSlot,
  descriptors: readonly ProviderDescriptor[],
): ConnectionDisplayValue[] {
  const descriptor = descriptorFor(slot.providerId, descriptors);
  if (!descriptor) {
    return [];
  }

  return fieldsForRole(descriptor, slot.role)
    .filter((field) => field.secret !== true)
    .flatMap((field) => {
      const value = slot.config[field.name];
      if (typeof value !== "string" || !value.trim()) {
        return [];
      }
      return [{ name: field.name, label: field.label, value: value.trim() }];
    });
}
