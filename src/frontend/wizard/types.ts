// src/frontend/wizard/types.ts — Shared types, constants, and envelopes for the onboarding wizard (spec #133, #142).

import type { GitIdentity, ProjectConnectionRole } from "../../shared/types.js";
import type { ProviderDescriptor } from "../connection/types.js";

/**
 * Draft schema version. Bumped to 2 by correction 2 (#133): the draft's
 * `connect` section stores the provider's configuration once, keyed by provider
 * id, instead of once per role — a v1 draft is structurally incompatible and is
 * discarded by `loadWizardDraft` rather than migrated.
 */
export const WIZARD_SCHEMA_VERSION = 2;

export const WIZARD_STEPS = [
  { id: "basics", label: "Basics", stepNumber: 1 },
  { id: "connect", label: "Connect", stepNumber: 2 },
  { id: "repositories", label: "Repositories", stepNumber: 3 },
  { id: "inspection", label: "Inspection", stepNumber: 4 },
  { id: "review", label: "Review", stepNumber: 5 },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];
export type WizardStepNumber = 1 | 2 | 3 | 4 | 5;

export interface WizardBasicsState {
  name: string;
  id: string;
  description: string;
  workspacePath: string;
}

/**
 * The connection roles the wizard collects (spec #133) — THE shared role type,
 * aliased rather than re-declared, so a role added to `ProjectConnectionRole`
 * is a wizard role too and no second union can drift apart from it (#176).
 */
export type WizardConnectionRole = ProjectConnectionRole;

/**
 * What the state records for one ROLE: which provider serves it, and whether
 * that role's verification of the provider's configuration succeeded.
 *
 * There is deliberately NO `config` here. Configuration belongs to the
 * PROVIDER, not to the role (correction 2, #133): a provider serving both roles
 * has exactly one configuration, and storing a copy per role is what allowed
 * the two cards to hold — and verify — different configurations while the
 * payload submitted only one of them.
 */
export interface WizardConnectionRoleState {
  providerId: string | null;
  verified?: boolean;
  /**
   * Contract capability names the last verification could not confirm
   * (`VerificationWarning.kind === "CAPABILITY_UNCONFIRMED"`). Persisted so a
   * downstream step can render the degraded evidence for its own capability —
   * for example the Repositories step naming `listRepositories` (#144).
   */
  unconfirmedCapabilities?: string[];
  /** Provably missing scopes per capability, persisted across step navigation. */
  missingScopes?: Record<string, string[]> | undefined;
  overPrivileged?: boolean | undefined;
}

export interface WizardConnectState {
  quickUrl: string;
  /**
   * THE authoritative configuration of each selected provider, keyed by
   * provider id — one entry per provider, never one per role. Both cards read
   * and write the entry of the provider they selected, so the configuration a
   * role verified is the configuration the payload submits, and an edit from
   * either card invalidates both roles' verification
   * (`src/frontend/wizard/state/connectConfig.ts`).
   */
  providerConfigs: Record<string, Record<string, unknown>>;
  /**
   * THE generation of each provider's configuration: a counter the reducer
   * bumps on every write to `providerConfigs[providerId]` — whichever card made
   * the write, and whichever role names the provider.
   *
   * It is the ONE staleness token for a verification in flight (correction 1,
   * #133). A verification captures the generation of the provider it asked
   * about; the reducer records the evidence only while that generation is still
   * current, so a configuration written from the PARTNER card — which bumps
   * this counter and cannot touch the asking card's own state — invalidates the
   * in-flight verification too. Without it, a late resolve could mark a
   * connection verified against a configuration nobody submitted.
   *
   * Session-scoped, like the verification evidence it guards: it is not part of
   * the persisted draft (the draft drops verification evidence anyway), so an
   * absent map reads as generation 0 (`configGeneration`).
   */
  providerConfigGenerations?: Record<string, number>;
  tracker: WizardConnectionRoleState;
  gitHost: WizardConnectionRoleState;
}

export interface WizardRepositoriesState {
  selectedRepoIds: string[];
  primaryRepoId: string | null;
  repoConfigs: Record<string, WizardRepoConfig>;
  /**
   * Fingerprint of the git-host connection configuration the current selection
   * was discovered from (`connectionConfigFingerprint`, a non-reversible
   * digest — never the config itself, which carries credentials). A selection
   * whose fingerprint no longer matches the current connection is out of date:
   * it must be re-made before the step can advance (spec #133 stale rule).
   */
  selectionFingerprint?: string | null;
}

/** One selected repository's role tags and per-repository settings. */
export interface WizardRepoConfig {
  /** The role tag carried into the creation payload (first listing role). */
  role: string;
  /**
   * Every connection role the repository was listed under (e.g. `gitHost` for
   * an application repository, `tracker` when the same connection also serves
   * as the issue tracker). Plain serialisable.
   */
  roles?: string[];
  localPath?: string;
  primary?: boolean;
}

export interface WizardInspectionState {
  acknowledged: boolean;
  /**
   * The git identity resolved for the project (#131 — project-level, never
   * nested in a connection), plain-serialisable. Absent when no complete
   * identity is configured for the inspected directory: the agent would have
   * none either, so nothing is fabricated here.
   */
  gitIdentity?: GitIdentity | undefined;
  /**
   * Selected repositories whose inspected directory resolved no identity. They
   * cannot author a commit, so a run that leaves any behind is a PARTIAL
   * resolution rather than a complete one.
   */
  unresolvedRepoIds?: string[] | undefined;
  /** The directory the identity was read from (provenance, shown at Review). */
  inspectedPath?: string | undefined;
  /**
   * Fingerprint of the inputs (selection + workspace root) the recorded
   * identity was resolved from — a non-reversible digest, never the config.
   * A different fingerprint means the record is out of date and the identity
   * must be re-inspected (spec #133 stale rule).
   */
  inputsFingerprint?: string | null | undefined;
  isGitRepo?: boolean | undefined;
  topLevelDir?: string | undefined;
  unresolvedPaths?: string[] | undefined;
  canUseLocalScope?: boolean | undefined;
  blockingLocalPath?: string | undefined;
  isBlockingPathRepo?: boolean | undefined;
}

export interface WizardReviewState {
  confirmed: boolean;
}

export interface WizardSourceState {
  step: WizardStepNumber;
  maxStepVisited: WizardStepNumber;
  basics: WizardBasicsState;
  connect: WizardConnectState;
  repositories: WizardRepositoriesState;
  inspection: WizardInspectionState;
  review: WizardReviewState;
}

export interface WizardDraftEnvelope {
  version: number;
  savedAt: string;
  state: WizardSourceState;
}

/**
 * The wizard's actions, each named for the ONE thing it may change. There is
 * deliberately no generic "patch the connect state" action (correction 1, #133):
 * a configuration may be written only through `UPDATE_PROVIDER_CONFIG` and
 * `APPLY_PROVIDER_MATCH`, which clear the verification of every role naming the
 * provider in the same step, and verification evidence only through
 * `RECORD_VERIFICATION`, which the reducer discards when the configuration it
 * asked about is no longer current. A blanket patch could replace a provider's
 * configuration while leaving every "verified" flag standing — the exact payload
 * a connection must never be submitted with — so no such action exists.
 */
export type WizardAction =
  | { type: "SET_STEP"; step: WizardStepNumber }
  | {
      type: "NEXT_STEP";
      descriptors?: readonly ProviderDescriptor[] | undefined;
    }
  | { type: "PREV_STEP" }
  | { type: "UPDATE_BASICS"; patch: Partial<WizardBasicsState> }
  | {
      type: "SELECT_PROVIDER";
      role: WizardConnectionRole;
      providerId: string | null;
    }
  | {
      type: "UPDATE_PROVIDER_CONFIG";
      providerId: string;
      config: Record<string, unknown>;
    }
  | {
      /**
       * Records the outcome of a verification attempt for one role — THE only
       * way verification evidence is written (correction 1, #133).
       *
       * `generation` is the configuration generation the attempt asked about. The
       * reducer records the evidence only while the provider still serves the
       * role AND its configuration still carries that generation, so an attempt
       * whose configuration was replaced — by EITHER card — is discarded rather
       * than recorded.
       */
      type: "RECORD_VERIFICATION";
      role: WizardConnectionRole;
      providerId: string;
      generation: number;
      verified: boolean;
      unconfirmedCapabilities: string[];
      missingScopes?: Record<string, string[]> | undefined;
      overPrivileged?: boolean | undefined;
    }
  | {
      type: "APPLY_PROVIDER_MATCH";
      providerId: string;
      config: Record<string, unknown>;
      roles: WizardConnectionRole[];
      url: string;
    }
  | { type: "UPDATE_REPOSITORIES"; patch: Partial<WizardRepositoriesState> }
  | { type: "UPDATE_INSPECTION"; patch: Partial<WizardInspectionState> }
  | { type: "UPDATE_REVIEW"; patch: Partial<WizardReviewState> }
  | { type: "RESTORE_DRAFT"; state: WizardSourceState }
  | { type: "RESET_STATE" };
