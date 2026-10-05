// src/frontend/wizard/state/wizardReducer.ts — Pure reducer for wizard state transitions (spec #126, #142).

import type {
  WizardAction,
  WizardSourceState,
  WizardStepNumber,
} from "../types.js";

export function createInitialWizardState(): WizardSourceState {
  return {
    step: 1,
    maxStepVisited: 1,
    basics: {
      name: "",
      id: "",
      description: "",
      workspacePath: "", // S3 fix: no hardcoded default workspace path!
    },
    connect: {
      quickUrl: "",
      tracker: {
        providerId: null,
        config: {},
        verified: false,
        degradedAccepted: false,
      },
      gitHost: {
        providerId: null,
        config: {},
        verified: false,
        degradedAccepted: false,
      },
    },
    repositories: {
      selectedRepoIds: [],
      primaryRepoId: null,
      repoConfigs: {},
    },
    inspection: {
      acknowledged: false,
    },
    review: {
      confirmed: false,
    },
  };
}

export function wizardReducer(
  state: WizardSourceState,
  action: WizardAction,
): WizardSourceState {
  switch (action.type) {
    case "SET_STEP": {
      if (action.step < 1 || action.step > 5) {
        return state;
      }
      // Strict state-machine boundary: cannot skip ahead to unvisited steps
      if (action.step > state.maxStepVisited) {
        return state;
      }
      return {
        ...state,
        step: action.step,
      };
    }

    case "NEXT_STEP": {
      if (state.step >= 5) {
        return state;
      }
      const nextStep = (state.step + 1) as WizardStepNumber;
      return {
        ...state,
        step: nextStep,
        maxStepVisited: Math.max(
          state.maxStepVisited,
          nextStep,
        ) as WizardStepNumber,
      };
    }

    case "PREV_STEP": {
      if (state.step <= 1) {
        return state;
      }
      const prevStep = (state.step - 1) as WizardStepNumber;
      // Monotonicity: backward navigation never corrupts or resets prior valid step data
      return {
        ...state,
        step: prevStep,
      };
    }

    case "UPDATE_BASICS": {
      return {
        ...state,
        basics: {
          ...state.basics,
          ...action.patch,
        },
      };
    }

    case "UPDATE_CONNECT": {
      return {
        ...state,
        connect: {
          ...state.connect,
          ...action.patch,
          tracker: action.patch.tracker
            ? {
                ...state.connect.tracker,
                ...action.patch.tracker,
              }
            : state.connect.tracker,
          gitHost: action.patch.gitHost
            ? {
                ...state.connect.gitHost,
                ...action.patch.gitHost,
              }
            : state.connect.gitHost,
        },
      };
    }

    case "UPDATE_REPOSITORIES": {
      return {
        ...state,
        repositories: {
          ...state.repositories,
          ...action.patch,
        },
      };
    }

    case "UPDATE_INSPECTION": {
      return {
        ...state,
        inspection: {
          ...state.inspection,
          ...action.patch,
        },
      };
    }

    case "UPDATE_REVIEW": {
      return {
        ...state,
        review: {
          ...state.review,
          ...action.patch,
        },
      };
    }

    case "RESTORE_DRAFT": {
      return {
        ...action.state,
      };
    }

    case "RESET_STATE": {
      return createInitialWizardState();
    }

    default:
      return state;
  }
}
