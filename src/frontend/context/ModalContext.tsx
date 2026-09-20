// src/frontend/context/ModalContext.tsx — Global modal state orchestration (XFM-46).

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

export interface NewRunPrefill {
  ticketId?: string;
  ticketTitle?: string;
  criteria?: string[];
  branch?: string;
  plan?: string;
}

interface ModalContextValue {
  isNewRunOpen: boolean;
  newRunPrefill: NewRunPrefill | null;
  openNewRunModal: (prefill?: NewRunPrefill) => void;
  closeNewRunModal: () => void;
  isOnboardingOpen: boolean;
  openOnboardingModal: () => void;
  closeOnboardingModal: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [isNewRunOpen, setIsNewRunOpen] = useState(false);
  const [newRunPrefill, setNewRunPrefill] = useState<NewRunPrefill | null>(
    null,
  );
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const openNewRunModal = useCallback((prefill?: NewRunPrefill) => {
    setNewRunPrefill(prefill ?? null);
    setIsNewRunOpen(true);
  }, []);

  const closeNewRunModal = useCallback(() => {
    setIsNewRunOpen(false);
    setNewRunPrefill(null);
  }, []);

  const openOnboardingModal = useCallback(() => {
    setIsOnboardingOpen(true);
  }, []);

  const closeOnboardingModal = useCallback(() => {
    setIsOnboardingOpen(false);
  }, []);

  return (
    <ModalContext.Provider
      value={{
        isNewRunOpen,
        newRunPrefill,
        openNewRunModal,
        closeNewRunModal,
        isOnboardingOpen,
        openOnboardingModal,
        closeOnboardingModal,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return ctx;
}
