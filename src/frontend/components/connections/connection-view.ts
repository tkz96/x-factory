// src/frontend/components/connections/connection-view.ts — THE connection view
// (#176): one derivation, two inputs, one role list.
//
// Every surface that reports how a project's connections stand derives its
// slots HERE, from one of exactly two inputs — the wizard's DRAFT (verification
// evidence per role) or a project's RECORDED connections (the normalized
// payload, or a pre-#145 project's `issueTracker`) — over THE one role list
// (`PROJECT_CONNECTION_ROLES`). The wizard's Review line and every
// post-creation surface therefore read one vocabulary
// (`connected | degraded | disconnected`) from one module: the line a user sees
// during onboarding and the line they see afterwards cannot drift apart.
//
// Each branch hands its two facts — is there a usable connection, does it
// carry warnings — to THE one three-state rule (`deriveConnectionState` in
// `connection-state.ts`), so no branch maps them to states on its own.
//
// The two branches differ only in what their evidence MEANS:
//
//   * draft: a connection exists when the role selected a provider AND that
//     configuration verified — `isConnectionUsable`, the same predicate the
//     Review gate and the cards read, so the line and the gate can never
//     disagree. Degraded when the verification left capabilities unconfirmed.
//     A selected-but-unverified provider is disconnected: verification results
//     are never persisted, so a restored draft must never read as connected.
//   * recorded: a connection exists when the payload records one for the role;
//     degraded when the manifest reports warnings (role not recorded,
//     incomplete configuration, unregistered provider). Configuration
//     incompleteness is a warning, not an absence.
//
// Provider-agnostic: no branch knows a provider id. Capabilities and the
// configuration-completeness check come from the providers manifest — the
// presentation contract — and display names stay `resolveProviderLabel`.

import {
  PROJECT_CONNECTION_ROLES,
  type Project,
  type ProjectConnectionRole,
} from "../../../shared/types.js";
import type {
  ProviderConfigFieldDescriptor,
  ProviderDescriptor,
} from "../../connection/types.js";
import {
  type ConnectionComboSlot,
  type ConnectionEvidence,
  type ConnectionState,
  deriveConnectionState,
  isConnectionUsable,
} from "./connection-state.js";

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
  readonly state: ConnectionState;
  readonly providerId: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;
  /** The provider's declared capabilities, from the manifest (empty if unknown). */
  readonly capabilities: readonly string[];
  readonly warnings: readonly ConnectionWarning[];
}

/** The wizard's DRAFT as this module reads it. */
export interface DraftConnectionSource {
  readonly kind: "draft";
  /**
   * Per role: which provider serves it and whether that role verified it —
   * structurally the wizard's `connect` state, without depending on it.
   */
  readonly evidence: Readonly<
    Record<ProjectConnectionRole, ConnectionEvidence>
  >;
  /**
   * The draft's ONE configuration per provider. Unlike a recorded project's
   * configuration this may contain the credentials the user typed: the slot's
   * `config` is an in-memory rendering input, and anything shown to a person
   * must go through `identityConfig` first (as
   * `draftConnectionIdentityTargets` does) (#133 correction 1).
   */
  readonly providerConfigs?:
    | Readonly<Record<string, Readonly<Record<string, unknown>>>>
    | undefined;
}

/** A project's RECORDED connections as this module reads them. */
export interface RecordedConnectionSource {
  readonly kind: "recorded";
  readonly project: Project;
}

/** The two, and only two, inputs a connection view is derived from (#176). */
export type ConnectionViewSource =
  | DraftConnectionSource
  | RecordedConnectionSource;

/** One slot per role of THE list, keyed by role — never read by position. */
export type ConnectionView = Readonly<
  Record<ProjectConnectionRole, ConnectionSlot>
>;

// ---------------------------------------------------------------------------
// Recorded connections: the project payload, normalized or legacy
// ---------------------------------------------------------------------------

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
  return PROJECT_CONNECTION_ROLES.filter((role) => roles.includes(role));
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

/** The manifest's descriptor for a provider id, when the manifest has one. */
export function descriptorFor(
  providerId: string | undefined,
  descriptors: readonly ProviderDescriptor[],
): ProviderDescriptor | undefined {
  if (!providerId) {
    return undefined;
  }
  return descriptors.find((descriptor) => descriptor.id === providerId);
}

/** Fields that apply to the role: role-scoped or unscoped (#128). */
export function fieldsForRole(
  descriptor: ProviderDescriptor,
  role: ProjectConnectionRole,
): ProviderConfigFieldDescriptor[] {
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

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** One draft role: verification evidence decides the state, never warnings. */
function draftSlot(
  role: ProjectConnectionRole,
  source: DraftConnectionSource,
  descriptors: readonly ProviderDescriptor[],
): ConnectionSlot {
  const evidence = source.evidence[role];
  const providerId = evidence.providerId ?? undefined;
  const unconfirmed = evidence.unconfirmedCapabilities ?? [];
  return {
    role,
    state: deriveConnectionState(
      isConnectionUsable(evidence),
      unconfirmed.length > 0,
    ),
    providerId,
    config:
      providerId === undefined
        ? {}
        : (source.providerConfigs?.[providerId] ?? {}),
    capabilities: descriptorFor(providerId, descriptors)?.capabilities ?? [],
    // A draft carries no recorded warnings: the Connect cards render their own
    // field-level feedback, and the line has never shown more than the state.
    warnings: [],
  };
}

/** One recorded role: presence decides the state, manifest warnings degrade. */
function recordedSlot(
  role: ProjectConnectionRole,
  connections: readonly DerivedConnection[],
  descriptors: readonly ProviderDescriptor[],
): ConnectionSlot {
  const connection = connectionForRole(connections, role);
  const warnings = warningsFor(role, connection, descriptors);
  return {
    role,
    state: deriveConnectionState(connection !== undefined, warnings.length > 0),
    providerId: connection?.providerId,
    config: connection?.config ?? {},
    capabilities: connection
      ? (descriptorFor(connection.providerId, descriptors)?.capabilities ?? [])
      : [],
    warnings,
  };
}

function viewOf(slots: readonly ConnectionSlot[]): ConnectionView {
  return Object.fromEntries(
    slots.map((slot) => [slot.role, slot]),
  ) as ConnectionView;
}

/**
 * Derives the whole connection view for one input, over THE one role list.
 * Pure: the same input and manifest always produce the same view, whichever
 * kind it is.
 *
 * Each slot is built FOR ITS OWN ROLE (never read back by position), and the
 * list's order is the render order: tracker first, then git host.
 */
export function deriveConnectionView(
  source: ConnectionViewSource,
  descriptors: readonly ProviderDescriptor[] = [],
): ConnectionView {
  if (source.kind === "draft") {
    return viewOf(
      PROJECT_CONNECTION_ROLES.map((role) =>
        draftSlot(role, source, descriptors),
      ),
    );
  }
  const connections = deriveConnections(source.project);
  return viewOf(
    PROJECT_CONNECTION_ROLES.map((role) =>
      recordedSlot(role, connections, descriptors),
    ),
  );
}

/**
 * The roles the DRAFT line REQUIRES: creation needs every role (#133: both
 * connections are mandatory at creation), so the Review line passes THESE to
 * `comboTone` — the intent is "required at creation", not "every role a line
 * can render". Deliberately THE all-roles list under its own name; a
 * post-creation surface passes its own narrower `REQUIRED_CONNECTION_ROLES`
 * (see `components/projects/connection-integrity.ts`).
 */
export const CREATION_REQUIRED_ROLES = PROJECT_CONNECTION_ROLES;

/**
 * The draft's combo-line slots in one call: THE chain the wizard's Review
 * step reads — derive the view from the DRAFT, take THE list's slots in
 * render order, and map them to the line's `string | null` vocabulary —
 * hidden behind one name so no surface re-nests it (#176).
 */
export function draftComboSlots(
  source: DraftConnectionSource,
  descriptors: readonly ProviderDescriptor[] = [],
): ConnectionComboSlot[] {
  const view = deriveConnectionView(source, descriptors);
  return connectionComboSlots(
    // THE list's order is the render order: tracker first, then git host.
    PROJECT_CONNECTION_ROLES.map((role) => view[role]),
  );
}

/**
 * A slot list restricted to `roles` when the surface renders a single role —
 * the ONE place the filter lives, so the combo line and the identity targets
 * can never disagree about which slots a line shows.
 */
export function slotsForRoles(
  slots: readonly ConnectionSlot[],
  roles?: readonly ProjectConnectionRole[],
): ConnectionSlot[] {
  const roleSet = roles !== undefined ? new Set(roles) : undefined;
  return slots.filter(
    (slot) => roleSet === undefined || roleSet.has(slot.role),
  );
}

/**
 * The combo line's slots for any view: the same mapping for the draft and the
 * recorded producer (#176), with `providerId` normalized to the line's
 * `string | null` vocabulary.
 */
export function connectionComboSlots(
  slots: readonly ConnectionSlot[],
  roles?: readonly ProjectConnectionRole[],
): ConnectionComboSlot[] {
  return slotsForRoles(slots, roles).map((slot) => ({
    role: slot.role,
    state: slot.state,
    providerId: slot.providerId ?? null,
  }));
}
