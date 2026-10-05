// src/frontend/wizard/steps/useRoleConnection.ts — State and verification lifecycle hook for a connection role.

import { useRef, useState } from "react";
import { isNormalizedError } from "../../components/feedback/copy-map.js";
import type { VerificationResult } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import type {
  WizardConnectionRoleState,
  WizardConnectState,
} from "../types.js";
import {
  deriveVerificationStatus,
  extractApiErrors,
} from "./connection-error-helpers.js";

export function useRoleConnection(
  role: "tracker" | "gitHost",
  roleState: WizardConnectionRoleState,
  dispatch: (action: {
    type: "UPDATE_CONNECT";
    patch: Partial<WizardConnectState>;
  }) => void,
  onManualChange?: (() => void) | undefined,
) {
  const [verification, setVerification] = useState<VerificationResult | null>(
    null,
  );
  const [error, setError] = useState<unknown | null>(null);
  const [isPending, setIsPending] = useState(false);
  const generationRef = useRef(0);

  const selectProvider = (providerId: string | null) => {
    generationRef.current += 1;
    setVerification(null);
    setError(null);
    setIsPending(false);
    onManualChange?.();
    dispatch({
      type: "UPDATE_CONNECT",
      patch: {
        [role]: {
          providerId,
          config: {},
          degradedAccepted: false,
        },
      },
    });
  };

  const updateConfig = (fieldName: string, value: unknown) => {
    generationRef.current += 1;
    setVerification(null);
    setError(null);
    setIsPending(false);
    onManualChange?.();
    dispatch({
      type: "UPDATE_CONNECT",
      patch: {
        [role]: {
          ...roleState,
          config: {
            ...roleState.config,
            [fieldName]: value,
          },
          degradedAccepted: false,
        },
      },
    });
  };

  const verify = async () => {
    if (!roleState.providerId) return;
    const currentGen = ++generationRef.current;
    setIsPending(true);
    setError(null);
    dispatch({
      type: "UPDATE_CONNECT",
      patch: {
        [role]: {
          degradedAccepted: false,
        },
      },
    });
    try {
      const res = await api.providers.verify({
        providerId: roleState.providerId,
        role,
        config: roleState.config,
      });
      if (currentGen !== generationRef.current) {
        return;
      }
      if (isNormalizedError(res)) {
        setError(res);
        setVerification(null);
      } else {
        setVerification(res);
        setError(null);
      }
    } catch (err) {
      if (currentGen !== generationRef.current) {
        return;
      }
      setError(err);
      setVerification(null);
    } finally {
      if (currentGen === generationRef.current) {
        setIsPending(false);
      }
    }
  };

  const acceptDegraded = () => {
    dispatch({
      type: "UPDATE_CONNECT",
      patch: {
        [role]: {
          degradedAccepted: true,
        },
      },
    });
  };

  const resetVerification = () => {
    generationRef.current += 1;
    setVerification(null);
    setError(null);
    setIsPending(false);
  };

  const status = deriveVerificationStatus(isPending, verification, error);
  const { fieldErrors, formErrors } = extractApiErrors(error);
  const isVerified =
    Boolean(roleState.providerId) &&
    (status === "ok" ||
      (status === "degraded" && Boolean(roleState.degradedAccepted)));

  return {
    verification,
    error,
    isPending,
    status,
    fieldErrors,
    formErrors,
    isVerified,
    degradedAccepted: Boolean(roleState.degradedAccepted),
    selectProvider,
    updateConfig,
    verify,
    acceptDegraded,
    resetVerification,
  };
}
