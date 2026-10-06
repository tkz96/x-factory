// src/frontend/wizard/steps/useRoleConnection.ts — State and verification lifecycle hook for a connection role.
//
// One instance per ROLE. The instance owns this card's local session state —
// the verification result it just received, the error it just surfaced, whether
// a request is in flight — while everything durable lives in the wizard state:
// the provider selection per role, and the configuration per PROVIDER. A role
// reads the configuration of the provider it selected (so a provider serving
// both roles is read, and written, through one record by both cards), and it
// keeps its own verification evidence, because verification is per role.

import { useRef, useState } from "react";
import { isNormalizedError } from "../../components/feedback/copy-map.js";
import type { VerificationResult } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { roleConfig } from "../state/connectConfig.js";
import type {
  WizardAction,
  WizardConnectionRole,
  WizardConnectionRoleState,
  WizardConnectState,
} from "../types.js";
import {
  deriveVerificationStatus,
  extractApiErrors,
} from "./connection-error-helpers.js";

export function useRoleConnection(
  role: WizardConnectionRole,
  connect: WizardConnectState,
  dispatch: (action: WizardAction) => void,
  onManualChange?: (() => void) | undefined,
) {
  const roleState: WizardConnectionRoleState = connect[role];
  // The authoritative configuration of the provider this role selected: the
  // ONE record both cards read and write when they name the same provider.
  const config = roleConfig(connect, role);
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
    dispatch({ type: "SELECT_PROVIDER", role, providerId });
  };

  const updateConfig = (fieldName: string, value: unknown) => {
    if (!roleState.providerId) return;
    generationRef.current += 1;
    setVerification(null);
    setError(null);
    setIsPending(false);
    onManualChange?.();
    // A write to the provider's configuration clears the verification of EVERY
    // role naming it, this one included: what was verified is no longer on
    // record.
    dispatch({
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: roleState.providerId,
      config: { ...config, [fieldName]: value },
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
        // The shared configuration, read at request time: the verification is
        // of what is on record for the provider, never of a per-role copy.
        config: roleConfig(connect, role),
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
        // verified flag is what survives a step change: the provider accepted
        // the credentials, and a later step can only re-verify it, never
        // re-invent it.
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

  const { fieldErrors, formErrors } = extractApiErrors(error);
  // The evidence this card displays is THIS role's verification, and it is only
  // current while the state still records this role as verified: a write to the
  // provider's shared configuration from EITHER card clears both roles'
  // evidence, and a card must stop showing a verification that no longer
  // corresponds to the configuration on record.
  const sessionVerification = roleState.verified === true ? verification : null;
  const sessionStatus = deriveVerificationStatus(
    isPending,
    sessionVerification,
    error,
  );
  // A degraded verification IS a verified connection (#133): its warnings are
  // surfaced on the card, never collected as an acknowledgement, and never a
  // reason to withhold anything.
  const isVerified =
    Boolean(roleState.providerId) &&
    (sessionStatus === "ok" || sessionStatus === "degraded");

  return {
    verification: sessionVerification,
    error,
    isPending,
    status: sessionStatus,
    fieldErrors,
    formErrors,
    isVerified,
    selectProvider,
    updateConfig,
    verify,
    resetVerification,
  };
}
