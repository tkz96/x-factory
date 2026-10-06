// src/frontend/components/projects/connection-integrity.ts — Post-creation
// connection surfacing (spec #133, ticket #147).
//
// Turns a project's normalized `connections` payload (#145 / #131) into the
// three-state descriptor every post-creation surface renders — connected,
// degraded (warnings present), disconnected — plus the no-tracker INTEGRITY
// FAILURE. Both connections are mandatory at creation (#133 §Wizard flow &
// UX), so "a project with no tracker" is not a supported mode: it is a durable
// configuration error with a repair path.
//
// Provider-agnosticism (spec #133, AGENTS.md): this module never branches on a
// provider id. Display names come from the providers manifest, the
// "configuration is incomplete" check is driven by the manifest's own field
// descriptors (`required` + `secret` + `roles`), and the legacy pre-#145
// fallback looks the provider's configuration up by its own id.
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
  type ConnectionState,
  identityConfig,
  resolveProviderLabel,
} from "../connections/connection-state.js";
import type { DerivedAsyncState } from "../feedback/types.js";

/** The three distinctions the combo line renders (one vocabulary, #148). */
export type ConnectionSlotState = ConnectionState;

/**
 * Why a slot is degraded. `details` carries the human-readable identifiers the
 * copy map interpolates: manifest configuration-field labels
 * (`CONFIG_INCOMPLETE`), the role name (`ROLE_NOT_RECORDED`), or the
 * unregistered provider id (`PROVIDER_UNKNOWN`).
 */
export type ConnectionWarningKind =
  | "ROLE_NOT_RECORDED"
  | "CONFIG_INCOMPLETE"
  | "PROVIDER_UNKNOWN";

export interface ConnectionWarning {
  readonly kind: ConnectionWarningKind;
  readonly role: ProjectConnectionRole;
  readonly details: readonly string[];
}

/** One role's connection as the surfaces render it. */
export interface ConnectionSlot {
  readonly role: ProjectConnectionRole;
  readonly state: ConnectionSlotState;
  readonly providerId: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;
  /** The provider's declared capabilities, from the manifest (empty if unknown). */
  readonly capabilities: readonly string[];
  readonly warnings: readonly ConnectionWarning[];
}

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

/** The roles in render order. The combo line always reads left to right. */
const ROLES: readonly ProjectConnectionRole[] = PROJECT_CONNECTION_ROLES;

/** A connection record as it is derived (normalized or legacy). */
interface DerivedConnection {
  readonly providerId: string;
  readonly roles: readonly ProjectConnectionRole[];
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * Legacy descriptors come from `issueTracker`; their configuration shape is
   * pre-#145 and unverifiable, so they are never reported as incomplete
   * (spec #133 keeps legacy config migration an open question).
   */
  readonly legacy: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRoleList(roles: readonly string[]): ProjectConnectionRole[] {
  return ROLES.filter((role) => roles.includes(role));
}

/**
 * The project's connections, normalized or derived.
 *
 * A present `connections` array is authoritative, empty or not: the ticket's
 * integrity failure is exactly "the normalized payload records no tracker".
 */
function deriveConnections(project: Project): DerivedConnection[] {
  const declared = project.connections;
  if (Array.isArray(declared)) {
    return declared.map((connection) => ({
      providerId: connection.providerId,
      roles: asRoleList(connection.roles),
      config: isRecord(connection.config) ? connection.config : {},
      legacy: false,
    }));
  }

  // Legacy project: derive a display-only tracker descriptor from
  // `issueTracker`. The lookup is by the record's own provider id — the
  // pre-#145 record namespaces its configuration under that key.
  const legacy = project.issueTracker as unknown as
    | Record<string, unknown>
    | undefined;
  const providerId =
    typeof legacy?.provider === "string"
      ? legacy.provider
      : typeof legacy?.connectionId === "string"
        ? legacy.connectionId
        : "";

  if (!providerId.trim()) {
    return [];
  }

  const namespaced = legacy?.[providerId];
  return [
    {
      providerId,
      roles: ["tracker"],
      config: isRecord(namespaced) ? namespaced : {},
      legacy: true,
    },
  ];
}

/** The slot's connection: the first record that declares the role. */
function connectionForRole(
  connections: readonly DerivedConnection[],
  role: ProjectConnectionRole,
): DerivedConnection | undefined {
  return connections.find((connection) => connection.roles.includes(role));
}

function descriptorFor(
  providerId: string | undefined,
  descriptors: readonly ProviderDescriptor[],
): ProviderDescriptor | undefined {
  if (!providerId) {
    return undefined;
  }
  return descriptors.find((descriptor) => descriptor.id === providerId);
}

/** Fields that apply to the role: role-scoped or unscoped (#128). */
function fieldsForRole(
  descriptor: ProviderDescriptor,
  role: ProjectConnectionRole,
) {
  return descriptor.configFields.filter(
    (field) =>
      field.roles === undefined ||
      field.roles.length === 0 ||
      field.roles.includes(role),
  );
}

/**
 * The slot's warnings. Nothing is reported before the manifest is loaded: an
 * unloaded manifest must never masquerade as an incomplete configuration.
 */
function warningsFor(
  role: ProjectConnectionRole,
  connection: DerivedConnection | undefined,
  descriptors: readonly ProviderDescriptor[],
): ConnectionWarning[] {
  if (!connection) {
    return [{ kind: "ROLE_NOT_RECORDED", role, details: [role] }];
  }

  if (descriptors.length === 0) {
    return [];
  }

  const descriptor = descriptorFor(connection.providerId, descriptors);

  if (!descriptor) {
    return [
      { kind: "PROVIDER_UNKNOWN", role, details: [connection.providerId] },
    ];
  }

  if (connection.legacy) {
    return [];
  }

  const missing = fieldsForRole(descriptor, role)
    .filter((field) => field.required && field.secret !== true)
    .filter((field) => {
      const value = connection.config[field.name];
      return typeof value !== "string" || !value.trim();
    })
    .map((field) => field.label);

  return missing.length > 0
    ? [{ kind: "CONFIG_INCOMPLETE", role, details: missing }]
    : [];
}

function slotState(
  connection: DerivedConnection | undefined,
  warnings: readonly ConnectionWarning[],
): ConnectionSlotState {
  if (!connection) {
    return "disconnected";
  }
  return warnings.length > 0 ? "degraded" : "connected";
}

function buildSlot(
  role: ProjectConnectionRole,
  connections: readonly DerivedConnection[],
  descriptors: readonly ProviderDescriptor[],
): ConnectionSlot {
  const connection = connectionForRole(connections, role);
  const warnings = warningsFor(role, connection, descriptors);
  return {
    role,
    state: slotState(connection, warnings),
    providerId: connection?.providerId,
    config: connection?.config ?? {},
    capabilities: connection
      ? (descriptorFor(connection.providerId, descriptors)?.capabilities ?? [])
      : [],
    warnings,
  };
}

/**
 * Derives the whole project's connection wiring for display. Pure: the same
 * project and manifest always produce the same integrity.
 *
 * Each slot is built FOR ITS OWN ROLE (never read back by position), and the
 * render order is the line's own order: tracker first, then git host.
 */
export function deriveConnectionIntegrity(
  project: Project,
  descriptors: readonly ProviderDescriptor[] = [],
): ConnectionIntegrity {
  const connections = deriveConnections(project);
  const tracker = buildSlot("tracker", connections, descriptors);
  const gitHost = buildSlot("gitHost", connections, descriptors);
  const slots = [tracker, gitHost];
  const warnings = slots.flatMap((slot) => slot.warnings);
  const hasIntegrityFailure = tracker.state === "disconnected";

  return {
    slots,
    tracker,
    gitHost,
    hasIntegrityFailure,
    isDegraded: !hasIntegrityFailure && warnings.length > 0,
    warnings,
  };
}

/**
 * The combo line's slots for a derived integrity: tracker first, then git host,
 * restricted to `roles` when the surface renders a single role.
 *
 * This is the persisted-connections producer of the ONE combo-line model (#148)
 * — the wizard's Review step produces the same shape from draft verification
 * evidence, and both render `ConnectionComboLine`.
 */
export function comboSlots(
  integrity: ConnectionIntegrity,
  roles?: readonly ProjectConnectionRole[],
): ConnectionComboSlot[] {
  return integrity.slots
    .filter((slot) => roles === undefined || roles.includes(slot.role))
    .map((slot) => ({
      role: slot.role,
      state: slot.state,
      providerId: slot.providerId ?? null,
    }));
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
  return integrity.slots
    .filter((slot) => roles === undefined || roles.includes(slot.role))
    .map((slot) => ({
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
