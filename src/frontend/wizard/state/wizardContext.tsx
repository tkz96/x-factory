// src/frontend/wizard/state/wizardContext.tsx — Wizard context and useWizard() hook (spec #126, #142).

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ProviderDescriptor } from "../../connection/types.js";
import { useProviderDescriptors } from "../../hooks/useProviderDescriptors.js";
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  storedDraftRequiresDescriptors,
} from "../storage.js";
import type {
  WizardAction,
  WizardBasicsState,
  WizardSourceState,
  WizardStepNumber,
} from "../types.js";
import { canAdvanceFromRepositories } from "./repositoryRules.js";
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
  descriptors?: readonly ProviderDescriptor[] | undefined;
}

const WizardContext = createContext<WizardContextValue | null>(null);

function getInitialState(
  descriptors?: readonly ProviderDescriptor[] | undefined,
): WizardSourceState {
  if (!descriptors || descriptors.length === 0) {
    if (storedDraftRequiresDescriptors()) {
      return createInitialWizardState();
    }
  }
  const draft = loadWizardDraft(descriptors);
  if (draft) {
    return draft;
  }
  return createInitialWizardState();
}

export function WizardProvider({
  children,
  descriptors: descriptorsProp,
}: {
  children: ReactNode;
  descriptors?: readonly ProviderDescriptor[] | undefined;
}) {
  const { data: descriptorsFromQuery } = useProviderDescriptors();
  const descriptors = descriptorsProp ?? descriptorsFromQuery;

  const [state, dispatch] = useReducer(
    wizardReducer,
    descriptors,
    getInitialState,
  );

  // Restore draft once descriptors become available (#133 contract).
  // If descriptors were undefined on mount, getInitialState could not restore provider
  // configs without descriptors. When descriptors arrive, restore the stored draft
  // using the descriptors for the stored provider ids.
  const restoredWithDescriptorsRef = useRef(
    descriptors && descriptors.length > 0
      ? true
      : !storedDraftRequiresDescriptors(),
  );

  useEffect(() => {
    if (restoredWithDescriptorsRef.current) return;
    if (!descriptors || !Array.isArray(descriptors) || descriptors.length === 0)
      return;

    const draft = loadWizardDraft(descriptors);
    if (draft) {
      restoredWithDescriptorsRef.current = true;
      dispatch({ type: "RESTORE_DRAFT", state: draft });
    }
  }, [descriptors]);

  const hasRequiredDescriptors = useCallback(
    (configs: Record<string, unknown> | undefined) => {
      if (!configs || Object.keys(configs).length === 0) return true;
      if (!descriptors || !Array.isArray(descriptors)) return false;
      const configuredIds = Object.keys(configs);
      return configuredIds.every((id) => descriptors.some((d) => d.id === id));
    },
    [descriptors],
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
        return true; // Connect gates itself on verification; #143 owns the rule
      case 3:
        // At least one application repository, selected under the connection
        // as it stands now (#144). Derived, never stored — the same predicate
        // the reducer's NEXT_STEP guard uses.
        return canAdvanceFromRepositories(state, descriptors);
      case 4:
        return true; // Scaffolding: later tickets supply step-specific validation rules
      case 5:
        return false; // Final review step does not advance, it submits
      default:
        return false;
    }
  }, [state, isBasicsValid, descriptors]);

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
    dispatch({ type: "NEXT_STEP", descriptors });
    if (hasRequiredDescriptors(state.connect.providerConfigs)) {
      saveWizardDraft(
        {
          ...state,
          step: nextStepNum,
          maxStepVisited: nextMax,
        },
        descriptors,
      );
    }
  }, [canAdvance, state, descriptors, hasRequiredDescriptors]);

  const prevStep = useCallback(() => {
    if (state.step <= 1) return;
    dispatch({ type: "PREV_STEP" });
  }, [state.step]);

  const goToStep = useCallback(
    (targetStep: WizardStepNumber) => {
      // Prevent forward navigation to bypass step validation
      if (!isStepAccessible(targetStep) || targetStep > state.step) return;
      dispatch({ type: "SET_STEP", step: targetStep });
      if (hasRequiredDescriptors(state.connect.providerConfigs)) {
        saveWizardDraft(
          {
            ...state,
            step: targetStep,
          },
          descriptors,
        );
      }
    },
    [isStepAccessible, state, descriptors, hasRequiredDescriptors],
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
      descriptors,
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
      descriptors,
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
