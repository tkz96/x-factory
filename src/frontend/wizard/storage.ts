// src/frontend/wizard/storage.ts — Versioned client draft persistence and secret-sanitization (spec #131, #142).

import type { ProviderDescriptor } from "../connection/types.js";
import {
  WIZARD_SCHEMA_VERSION,
  type WizardDraftEnvelope,
  type WizardSourceState,
} from "./types.js";

const WIZARD_DRAFT_STORAGE_KEY = "xf_wizard_draft_v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidProviderDescriptor(desc: unknown): desc is ProviderDescriptor {
  if (!isRecord(desc)) {
    return false;
  }
  if (typeof desc.id !== "string" || desc.id.trim() === "") {
    return false;
  }
  if (!Array.isArray(desc.configFields)) {
    return false;
  }
  for (const field of desc.configFields) {
    if (
      !isRecord(field) ||
      typeof field.name !== "string" ||
      field.name.trim() === ""
    ) {
      return false;
    }
  }
  return true;
}

function extractSecretNames(descriptor: ProviderDescriptor): Set<string> {
  const secretNames = new Set<string>();
  for (const field of descriptor.configFields) {
    const isSecret =
      field.secret === true ||
      (field.secret !== false && field.type === "secret");
    if (isSecret) {
      secretNames.add(field.name);
    }
  }
  return secretNames;
}

function sanitizeConfig(
  config: Record<string, unknown>,
  secretNames: ReadonlySet<string>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    // envKey must NEVER be persisted under any circumstances
    if (/^env_?key$/i.test(key)) {
      continue;
    }
    // Secret fields declared by provider metadata must be stripped
    if (secretNames.has(key)) {
      continue;
    }
    if (Array.isArray(val)) {
      clean[key] = val.map((item) => sanitizeNode(item, secretNames));
    } else if (isRecord(val)) {
      clean[key] = sanitizeConfig(val, secretNames);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Sanitizes an arbitrary nested value (object or array member) recursively:
 * arrays are traversed element by element, objects key by key, scalars pass
 * through. Secret-bearing keys are dropped at every depth according to provider
 * metadata.
 */
function sanitizeNode(
  value: unknown,
  secretNames: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNode(item, secretNames));
  }
  if (isRecord(value)) {
    return sanitizeConfig(value, secretNames);
  }
  return value;
}

function sanitizeProviderConfigs(
  providerConfigs: Record<string, Record<string, unknown>> | undefined,
  descriptors?: readonly ProviderDescriptor[] | undefined,
): Record<string, Record<string, unknown>> {
  if (!descriptors || !Array.isArray(descriptors)) {
    return {};
  }

  const clean: Record<string, Record<string, unknown>> = {};
  for (const [providerId, config] of Object.entries(providerConfigs ?? {})) {
    const descriptor = descriptors.find(
      (entry) => isRecord(entry) && entry.id === providerId,
    );
    // If provider is not found or descriptor is malformed, fail closed: omit config
    if (!descriptor || !isValidProviderDescriptor(descriptor)) {
      continue;
    }

    const secretNames = extractSecretNames(descriptor);
    clean[providerId] = sanitizeConfig(config || {}, secretNames);
  }
  return clean;
}

function sanitizeStateForDraft(
  state: WizardSourceState,
  descriptors?: readonly ProviderDescriptor[] | undefined,
): WizardSourceState {
  return {
    ...state,
    connect: {
      quickUrl: state.connect.quickUrl,
      // The provider's ONE configuration, sanitized: secrets never reach the
      // draft (#131), and a provider serving both roles has a single entry here
      // rather than a copy per role.
      providerConfigs: sanitizeProviderConfigs(
        state.connect.providerConfigs,
        descriptors,
      ),
      tracker: {
        providerId: state.connect.tracker.providerId,
        verified: false,
      },
      gitHost: {
        providerId: state.connect.gitHost.providerId,
        verified: false,
      },
    },
    inspection: {
      // The resolved identity and its provenance are DROPPED, exactly like the
      // verification results above: a restored draft must be re-inspected, so
      // apparently-valid old evidence can never survive a credential or
      // repository change (#133 stale rule, #146).
      acknowledged: false,
    },
    review: {
      confirmed: false,
    },
  };
}

function isStepNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

function isBasicsState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.id === "string" &&
    typeof value.description === "string" &&
    typeof value.workspacePath === "string"
  );
}

function isConnectionRoleState(value: unknown): boolean {
  return (
    isRecord(value) &&
    (typeof value.providerId === "string" || value.providerId === null) &&
    (value.verified === undefined || typeof value.verified === "boolean") &&
    (value.unconfirmedCapabilities === undefined ||
      (Array.isArray(value.unconfirmedCapabilities) &&
        value.unconfirmedCapabilities.every(
          (capability) => typeof capability === "string",
        ))) &&
    (value.missingScopes === undefined ||
      (isRecord(value.missingScopes) &&
        Object.values(value.missingScopes).every(
          (scopes) =>
            Array.isArray(scopes) && scopes.every((s) => typeof s === "string"),
        )))
  );
}

/**
 * The provider-keyed configuration map: every value an object (the provider's
 * one configuration), every key a provider id.
 */
function isProviderConfigs(value: unknown): boolean {
  return (
    isRecord(value) && Object.values(value).every((config) => isRecord(config))
  );
}

function isConnectState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.quickUrl === "string" &&
    isProviderConfigs(value.providerConfigs) &&
    isConnectionRoleState(value.tracker) &&
    isConnectionRoleState(value.gitHost)
  );
}

/**
 * Per-repository configuration value:
 * `{ role, roles?, localPath?, primary? }`.
 */
function isRepoConfigValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    (value.roles === undefined ||
      (Array.isArray(value.roles) &&
        value.roles.every((role) => typeof role === "string"))) &&
    (value.localPath === undefined || typeof value.localPath === "string") &&
    (value.primary === undefined || typeof value.primary === "boolean")
  );
}

function isRepositoriesState(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.selectedRepoIds) &&
    value.selectedRepoIds.every((id) => typeof id === "string") &&
    (value.primaryRepoId === null || typeof value.primaryRepoId === "string") &&
    isRecord(value.repoConfigs) &&
    Object.values(value.repoConfigs).every(isRepoConfigValue) &&
    (value.selectionFingerprint === undefined ||
      value.selectionFingerprint === null ||
      typeof value.selectionFingerprint === "string")
  );
}

/**
 * Validates the inspection section of a restored draft as untrusted input: the
 * recorded identity, the repositories it could not resolve, the directory it
 * was read from, and the fingerprint of the inputs it belongs to. Anything
 * malformed fails the whole draft.
 */
function isInspectionState(value: unknown): boolean {
  if (!isRecord(value) || typeof value.acknowledged !== "boolean") {
    return false;
  }
  const identity = value.gitIdentity;
  if (
    identity !== undefined &&
    (!isRecord(identity) ||
      typeof identity.name !== "string" ||
      typeof identity.email !== "string")
  ) {
    return false;
  }
  const unresolved = value.unresolvedRepoIds;
  if (
    unresolved !== undefined &&
    (!Array.isArray(unresolved) ||
      !unresolved.every((id) => typeof id === "string"))
  ) {
    return false;
  }
  if (
    value.inspectedPath !== undefined &&
    typeof value.inspectedPath !== "string"
  ) {
    return false;
  }
  return (
    value.inputsFingerprint === undefined ||
    value.inputsFingerprint === null ||
    typeof value.inputsFingerprint === "string"
  );
}

/**
 * Validates persisted draft state as untrusted input. Only a structurally
 * complete `WizardSourceState` is accepted; anything else (missing sections,
 * wrong types, malformed nested structures) is discarded by the caller.
 *
 * The state-machine invariant the reducer enforces — a user can never be on a
 * step beyond the furthest one visited — is re-checked here, because a crafted
 * payload of `{ step: 5, maxStepVisited: 1 }` would otherwise be restored
 * straight into `RESTORE_DRAFT` and defeat the invariant at the boundary.
 */
function isValidWizardState(value: unknown): value is WizardSourceState {
  if (!isRecord(value)) return false;
  if (!isStepNumber(value.step) || !isStepNumber(value.maxStepVisited)) {
    return false;
  }
  if (value.step > value.maxStepVisited) {
    return false;
  }
  return (
    isBasicsState(value.basics) &&
    isConnectState(value.connect) &&
    isRepositoriesState(value.repositories) &&
    isInspectionState(value.inspection) &&
    isRecord(value.review) &&
    typeof value.review.confirmed === "boolean"
  );
}

export function saveWizardDraft(
  state: WizardSourceState,
  descriptors?: readonly ProviderDescriptor[] | undefined,
): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    const safeState = sanitizeStateForDraft(state, descriptors);
    const envelope: WizardDraftEnvelope = {
      version: WIZARD_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      state: safeState,
    };
    window.localStorage.setItem(
      WIZARD_DRAFT_STORAGE_KEY,
      JSON.stringify(envelope),
    );
    return true;
  } catch {
    return false;
  }
}

export function getStoredDraftState(): WizardSourceState | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const envelope = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      envelope.version !== WIZARD_SCHEMA_VERSION
    ) {
      window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
      return null;
    }
    const state = envelope.state;
    if (!isValidWizardState(state)) {
      window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function loadWizardDraft(
  descriptors?: readonly ProviderDescriptor[] | undefined,
): WizardSourceState | null {
  const state = getStoredDraftState();
  if (!state) {
    return null;
  }
  return sanitizeStateForDraft(state, descriptors);
}

export function storedDraftRequiresDescriptors(): boolean {
  const state = getStoredDraftState();
  if (!state) return false;
  return Object.keys(state.connect.providerConfigs).length > 0;
}

export function clearWizardDraft(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
