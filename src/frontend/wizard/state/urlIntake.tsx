// src/frontend/wizard/state/urlIntake.tsx — The repository URL's question to the
// providers, and where its answer is applied (#268, spec #241 story 112).
//
// The first step collects one URL; the providers are asked about it when the
// field is left and when Continue is pressed, and a match pre-fills the Connect
// step's cards. The question NEEDS the provider manifest — it names the
// providers a match may point at — and it is asked from the step while the
// manifest is fetched by the app, so a user who continues immediately can reach
// step 2 before the answer is possible.
//
// That is why this lives in the SHEET, which outlives every step: a question
// asked on step 1 is held until the providers are known and answered wherever
// the user has got to by then. Held inside the step it would be dropped the
// moment Continue unmounts it. The step keeps only what a field needs: the
// value, and the informational message for a URL no registered provider claims.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ProviderDescriptor } from "../../connection/types.js";
import { useQuickUrlIntake } from "../steps/useQuickUrlIntake.js";
import { useWizard } from "./wizardContext.js";

interface WizardUrlIntakeValue {
  /** Asks the providers about a URL: on leaving the field, and on Continue. */
  ask: (url: string) => void;
  /** The informational message for a URL no registered provider claims. */
  missMessage: string | null;
}

const WizardUrlIntakeContext = createContext<WizardUrlIntakeValue>({
  ask: () => {},
  missMessage: null,
});

/** The URL intake, as a step sees it. */
export function useWizardUrlIntake(): WizardUrlIntakeValue {
  return useContext(WizardUrlIntakeContext);
}

export function WizardUrlIntakeProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, updateBasics, descriptors } = useWizard();
  const manifest = useMemo<ProviderDescriptor[]>(
    () => (descriptors === undefined ? [] : [...descriptors]),
    [descriptors],
  );
  const providersKnown = manifest.length > 0;

  const intake = useQuickUrlIntake({
    initialUrl: state.connect.quickUrl,
    manifest,
    basicsName: state.basics.name,
    dispatch,
    updateBasics,
    // There are no connection cards here: the reducer's APPLY_PROVIDER_MATCH
    // already clears every role's verification, which is the whole of what the
    // cards' local attempt state mirrors.
    onResetVerifications: () => {},
  });

  // The URL the user asked about, held only while the providers are unknown.
  const heldRef = useRef<string | null>(null);
  // The last URL actually asked, so leaving the field twice asks once.
  const askedRef = useRef<string | null>(null);

  const ask = (candidate: string) => {
    const trimmed = candidate.trim();
    if (trimmed === "" || askedRef.current === trimmed) return;
    if (!providersKnown) {
      heldRef.current = trimmed;
      return;
    }
    askedRef.current = trimmed;
    heldRef.current = null;
    void intake.handleQuickUrlSubmit(trimmed);
  };

  useEffect(() => {
    const held = heldRef.current;
    if (!providersKnown || held === null) return;
    heldRef.current = null;
    askedRef.current = held;
    void intake.handleQuickUrlSubmit(held);
  }, [providersKnown, intake]);

  return (
    <WizardUrlIntakeContext.Provider
      value={{ ask, missMessage: intake.quickUrlMissMessage }}
    >
      {children}
    </WizardUrlIntakeContext.Provider>
  );
}
