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
          // A different provider is unverified evidence until it is verified:
          // committing a project on the previous provider's verification would
          // be exactly the stale value the wizard must never carry forward.
          verified: false,
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
          // Editing what was verified invalidates the verification.
          verified: false,
        },
      },
    });
  };

  const verify = async () => {
    if (!roleState.providerId) return;
    const currentGen = ++generationRef.current;
    setIsPending(true);
    setError(null);
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
        dispatch({
          type: "UPDATE_CONNECT",
          patch: { [role]: { verified: false, unconfirmedCapabilities: [] } },
        });
      } else {
        setVerification(res);
        setError(null);
        // Degraded verification is evidence, not an error: persist exactly
        // which contract capabilities could not be confirmed so downstream
        // steps can name the capability they depend on (#129, #144). The
        // verified flag is what survives a step change: the credentials were
        // accepted, and a later step can only re-verify it, never re-invent it.
        dispatch({
          type: "UPDATE_CONNECT",
          patch: {
            [role]: {
              verified: true,
              unconfirmedCapabilities:
                res.status === "degraded"
                  ? res.warnings
                      .filter((w) => w.kind === "CAPABILITY_UNCONFIRMED")
                      .map((w) => w.capability)
                  : [],
            },
          },
        });
      }
    } catch (err) {
      if (currentGen !== generationRef.current) {
        return;
      }
      setError(err);
      setVerification(null);
      dispatch({
        type: "UPDATE_CONNECT",
        patch: { [role]: { verified: false, unconfirmedCapabilities: [] } },
      });
    } finally {
      if (currentGen === generationRef.current) {
        setIsPending(false);
      }
    }
  };

  const resetVerification = () => {
    generationRef.current += 1;
    setVerification(null);
    setError(null);
    setIsPending(false);
  };

  const status = deriveVerificationStatus(isPending, verification, error);
  const { fieldErrors, formErrors } = extractApiErrors(error);
  // A degraded verification IS a verified connection (#133): its warnings are
  // surfaced on the card, never collected as an acknowledgement, and never a
  // reason to withhold anything.
  const isVerified =
    Boolean(roleState.providerId) && (status === "ok" || status === "degraded");

  return {
    verification,
    error,
    isPending,
    status,
    fieldErrors,
    formErrors,
    isVerified,
    selectProvider,
    updateConfig,
    verify,
    resetVerification,
  };
}
