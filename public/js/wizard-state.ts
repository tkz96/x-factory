// public/js/wizard-state.ts — Explicit finite state machine and state management for project onboarding wizard.

import type {
  DiscoveredRepo,
  Project,
  ProjectRepository,
  RepositoryReadiness,
  RepositoryRole,
} from "../../src/shared/types.js";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

// fallow-ignore-next-line unused-export
export const WIZARD_TRANSITIONS: Record<WizardStep, WizardStep[]> = {
  1: [2],
  2: [1, 3],
  3: [2, 4],
  4: [3, 5],
  5: [4, 6],
  6: [5],
};

export function canTransitionWizardStep(
  from: WizardStep,
  to: WizardStep,
  maxStepReached: WizardStep = from,
): boolean {
  if (to === from) return true;
  if (to <= maxStepReached && to >= 1) return true;
  return WIZARD_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface SelectedWizardRepo extends DiscoveredRepo {
  role?: RepositoryRole | undefined;
  isPrimary?: boolean | undefined;
  path?: string | undefined;
  commands?: ProjectRepository["commands"] | undefined;
}

export interface WizardState {
  step: WizardStep;
  maxStepReached: WizardStep;
  projectName: string;
  projectId: string;
  workspacePath: string;
  tracker: string;
  trackerProject: string;
  trackerOrgUrl: string;
  trackerPat: string;
  trackerHost: string;
  trackerEmail: string;
  trackerToken: string;
  discoverySource: string;
  primaryRepo: string;
  discovered: DiscoveredRepo[];
  selectedRepos: Map<string, SelectedWizardRepo>;
  inspectionResults: Map<string, RepositoryReadiness>;
  knowledgeRepoId: string | null;
  errorMessage: string;
}

export function createInitialWizardState(): WizardState {
  return {
    step: 1,
    maxStepReached: 1,
    projectName: "",
    projectId: "",
    workspacePath: "/Users/talhazuberi/projects",
    tracker: "azure",
    trackerProject: "",
    trackerOrgUrl: "",
    trackerPat: "",
    trackerHost: "",
    trackerEmail: "",
    trackerToken: "",
    discoverySource: "local",
    primaryRepo: "",
    discovered: [],
    selectedRepos: new Map(),
    inspectionResults: new Map(),
    knowledgeRepoId: null,
    errorMessage: "",
  };
}

export class WizardStateMachine {
  private state: WizardState;

  constructor(initialState?: WizardState) {
    this.state = initialState || createInitialWizardState();
  }

  getState(): Readonly<WizardState> {
    return this.state;
  }

  reset(): void {
    this.state = createInitialWizardState();
  }

  setError(msg: string): void {
    this.state.errorMessage = msg;
  }

  clearError(): void {
    this.state.errorMessage = "";
  }

  transitionTo(nextStep: WizardStep): boolean {
    if (
      !canTransitionWizardStep(
        this.state.step,
        nextStep,
        this.state.maxStepReached,
      )
    ) {
      return false;
    }
    this.state.step = nextStep;
    if (nextStep > this.state.maxStepReached) {
      this.state.maxStepReached = nextStep;
    }
    this.clearError();
    return true;
  }

  update(patch: Partial<Omit<WizardState, "step" | "maxStepReached">>): void {
    Object.assign(this.state, patch);
  }
}

export function buildProjectConfig(s: WizardState): Project {
  const repos: ProjectRepository[] = Array.from(s.selectedRepos.values()).map(
    (r) => ({
      id: r.name,
      name: r.name,
      remote: r.remote || undefined,
      path: r.path || `${s.workspacePath.replace(/\/+$/, "")}/${r.name}`,
      defaultBranch: r.defaultBranch || "main",
      role: (r.role || "other") as RepositoryRole,
      commands: r.commands || undefined,
    }),
  );

  const primary =
    repos.find(
      (r) => r.name.toLowerCase() === (s.primaryRepo || "").toLowerCase(),
    ) || repos[0];

  return {
    id: s.projectId,
    name: s.projectName,
    workspacePath: s.workspacePath,
    issueTracker: {
      connectionId: s.tracker,
      projectId: s.trackerProject || undefined,
    },
    repositories: repos,
    knowledgeRepository: s.knowledgeRepoId
      ? {
          repositoryId: s.knowledgeRepoId,
          path: `${s.workspacePath.replace(/\/+$/, "")}/${s.knowledgeRepoId}`,
          type: "graphify",
        }
      : undefined,
    repositoryPath: primary?.path || s.workspacePath,
    defaultBranch: primary?.defaultBranch || "main",
    testCommand: primary?.commands?.test || "",
    typecheckCommand: primary?.commands?.typecheck || undefined,
    lintCommand: primary?.commands?.lint || undefined,
  };
}
