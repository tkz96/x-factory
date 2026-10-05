// src/frontend/wizard/state/wizardContext.tsx — Wizard context and useWizard() hook (spec #126, #142).

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
} from "../storage.js";
import type {
  WizardAction,
  WizardBasicsState,
  WizardSourceState,
  WizardStepNumber,
} from "../types.js";
import { createInitialWizardState, wizardReducer } from "./wizardReducer.js";

interface WizardContextValue {
  state: WizardSourceState;
  dispatch: React.Dispatch<WizardAction>;
  isBasicsValid: boolean;
  canAdvance: boolean;
  canGoBack: boolean;
  isStepAccessible: (step: WizardStepNumber) => boolean;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: WizardStepNumber) => void;
  resetWizard: () => void;
  updateBasics: (patch: Partial<WizardBasicsState>) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

function getInitialState(): WizardSourceState {
  const draft = loadWizardDraft();
  if (draft) {
    return draft;
  }
  return createInitialWizardState();
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    wizardReducer,
    undefined,
    getInitialState,
  );

  // Derived values — computed at render time, NEVER stored in state, NEVER synced via useEffect
  const isBasicsValid = useMemo(() => {
    return Boolean(state.basics.name.trim() && state.basics.id.trim());
  }, [state.basics.name, state.basics.id]);

  const canAdvance = useMemo(() => {
    switch (state.step) {
      case 1:
        return isBasicsValid;
      case 2:
      case 3:
      case 4:
        return true; // Scaffolding: later tickets supply step-specific validation rules
      case 5:
        return false; // Final review step does not advance, it submits
      default:
        return false;
    }
  }, [state.step, isBasicsValid]);

  const canGoBack = state.step > 1;

  const isStepAccessible = useCallback(
    (step: WizardStepNumber) => {
      return step <= state.maxStepVisited;
    },
    [state.maxStepVisited],
  );

  const nextStep = useCallback(() => {
    if (!canAdvance) return;
    const nextStepNum = Math.min(5, state.step + 1) as WizardStepNumber;
    const nextMax = Math.max(
      state.maxStepVisited,
      nextStepNum,
    ) as WizardStepNumber;
    dispatch({ type: "NEXT_STEP" });
    saveWizardDraft({
      ...state,
      step: nextStepNum,
      maxStepVisited: nextMax,
    });
  }, [canAdvance, state]);

  const prevStep = useCallback(() => {
    if (state.step <= 1) return;
    dispatch({ type: "PREV_STEP" });
  }, [state.step]);

  const goToStep = useCallback(
    (targetStep: WizardStepNumber) => {
      // Prevent forward navigation to bypass step validation
      if (!isStepAccessible(targetStep) || targetStep > state.step) return;
      dispatch({ type: "SET_STEP", step: targetStep });
      saveWizardDraft({
        ...state,
        step: targetStep,
      });
    },
    [isStepAccessible, state],
  );

  const resetWizard = useCallback(() => {
    dispatch({ type: "RESET_STATE" });
    clearWizardDraft();
  }, []);

  const updateBasics = useCallback((patch: Partial<WizardBasicsState>) => {
    dispatch({ type: "UPDATE_BASICS", patch });
  }, []);

  const contextValue = useMemo<WizardContextValue>(
    () => ({
      state,
      dispatch,
      isBasicsValid,
      canAdvance,
      canGoBack,
      isStepAccessible,
      nextStep,
      prevStep,
      goToStep,
      resetWizard,
      updateBasics,
    }),
    [
      state,
      isBasicsValid,
      canAdvance,
      canGoBack,
      isStepAccessible,
      nextStep,
      prevStep,
      goToStep,
      resetWizard,
      updateBasics,
    ],
  );

  return (
    <WizardContext.Provider value={contextValue}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return ctx;
}
