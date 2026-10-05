// src/frontend/wizard/types.ts — Shared types, constants, and envelopes for the onboarding wizard (spec #133, #142).

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
}

export interface WizardConnectState {
  quickUrl: string;
  tracker: WizardConnectionRoleState;
  gitHost: WizardConnectionRoleState;
}

export interface WizardRepositoriesState {
  selectedRepoIds: string[];
  primaryRepoId: string | null;
  repoConfigs: Record<
    string,
    { role: string; localPath?: string; primary?: boolean }
  >;
}

export interface WizardInspectionState {
  acknowledged: boolean;
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
