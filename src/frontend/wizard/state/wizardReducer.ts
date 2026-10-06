// src/frontend/wizard/state/wizardReducer.ts — Pure reducer for wizard state transitions (spec #126, #142).

import type {
  WizardAction,
  WizardSourceState,
  WizardStepNumber,
} from "../types.js";
import {
  applyProviderMatch,
  configGeneration,
  selectProvider,
  writeProviderConfig,
} from "./connectConfig.js";
import { canAdvanceFromRepositories } from "./repositoryRules.js";

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
      providerConfigs: {},
      tracker: {
        providerId: null,
        verified: false,
      },
      gitHost: {
        providerId: null,
        verified: false,
      },
    },
    repositories: {
      selectedRepoIds: [],
      primaryRepoId: null,
      repoConfigs: {},
      selectionFingerprint: null,
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
      // Step 3 guards the state machine itself (#144): no application
      // repository selected — or a selection made under a connection that has
      // since changed — means the journey cannot move on.
      if (state.step === 3 && !canAdvanceFromRepositories(state)) {
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

    case "RECORD_VERIFICATION": {
      const { connect } = state;
      // THE staleness guard for a verification that came back late (correction
      // 1, #133). The generation is the authoritative configuration's own, so a
      // write from EITHER card invalidates the attempt — the asking card's own
      // counter cannot see its partner's write. The role must still name the
      // provider too: evidence belongs to the connection it was obtained for.
      if (connect[action.role].providerId !== action.providerId) {
        return state;
      }
      if (configGeneration(connect, action.providerId) !== action.generation) {
        return state;
      }
      return {
        ...state,
        connect: {
          ...connect,
          [action.role]: {
            ...connect[action.role],
            verified: action.verified,
            unconfirmedCapabilities: action.unconfirmedCapabilities,
          },
        },
      };
    }

    // The three connection transitions live in `connectConfig.ts`, so the
    // invariant they enforce — one configuration per provider, and an edit
    // invalidating every role that verified it — holds for EVERY write, not
    // just for the ones a card happens to make.
    case "SELECT_PROVIDER": {
      return {
        ...state,
        connect: selectProvider(state.connect, action.role, action.providerId),
      };
    }

    case "UPDATE_PROVIDER_CONFIG": {
      return {
        ...state,
        connect: writeProviderConfig(
          state.connect,
          action.providerId,
          action.config,
        ),
      };
    }

    case "APPLY_PROVIDER_MATCH": {
      return {
        ...state,
        connect: {
          ...applyProviderMatch(
            state.connect,
            action.providerId,
            action.config,
            action.roles,
          ),
          quickUrl: action.url,
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
