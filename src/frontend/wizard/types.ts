// src/frontend/wizard/types.ts — Shared types, constants, and envelopes for the onboarding wizard (spec #133, #142).

import type { GitIdentity } from "../../shared/types.js";

export const WIZARD_SCHEMA_VERSION = 1;

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

export interface WizardConnectionRoleState {
  providerId: string | null;
  config: Record<string, unknown>;
  verified?: boolean;
  /**
   * Contract capability names the last verification could not confirm
   * (`VerificationWarning.kind === "CAPABILITY_UNCONFIRMED"`). Persisted so a
   * downstream step can render the degraded evidence for its own capability —
   * for example the Repositories step naming `listRepositories` (#144).
   */
  unconfirmedCapabilities?: string[];
}

export interface WizardConnectState {
  quickUrl: string;
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

export type WizardAction =
  | { type: "SET_STEP"; step: WizardStepNumber }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "UPDATE_BASICS"; patch: Partial<WizardBasicsState> }
  | { type: "UPDATE_CONNECT"; patch: Partial<WizardConnectState> }
  | { type: "UPDATE_REPOSITORIES"; patch: Partial<WizardRepositoriesState> }
  | { type: "UPDATE_INSPECTION"; patch: Partial<WizardInspectionState> }
  | { type: "UPDATE_REVIEW"; patch: Partial<WizardReviewState> }
  | { type: "RESTORE_DRAFT"; state: WizardSourceState }
  | { type: "RESET_STATE" };
