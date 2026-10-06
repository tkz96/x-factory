// src/frontend/wizard/steps/useRoleConnection.ts — State and verification lifecycle hook for a connection role.
//
// One instance per ROLE. The instance owns this card's local session state — the
// verification result it just received, the error it just surfaced, whether a
// request is in flight — while everything durable lives in the wizard state: the
// provider selection per role, the configuration per PROVIDER, and the
// verification EVIDENCE per role. A role reads the configuration of the provider
// it selected (so a provider serving both roles is read, and written, through
// one record by both cards).
//
// The session state is transient BY CONSTRUCTION: only the ACTIVE step is
// rendered, so navigating away unmounts this hook and drops it. The EVIDENCE is
// what survives, and it is what answers whether the role is verified
// (correction 5, #133).

import { useRef, useState } from "react";
import { isConnectionUsable } from "../../components/connections/connection-state.js";
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
  resolveVerificationDisplay,
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
  // The card's displayed evidence is derived from BOTH sources, in one place:
  // the result just received, and the evidence the wizard state persists for
  // this role. The state is authoritative for the FACT — the hook's local state
  // is gone as soon as the step unmounts (only the ACTIVE step is rendered), so
  // a remount must not silently un-verify a role the reducer still records as
  // verified. A provider change, a configuration write from EITHER card and a
  // Quick-URL match all clear that evidence, and the display follows it down —
  // a result still in hand then belongs to a configuration nobody verified.
  const displayVerification = resolveVerificationDisplay(
    verification,
    roleState,
  );
  const sessionStatus = deriveVerificationStatus(
    isPending,
    verification,
    error,
    roleState,
  );
  // A degraded verification IS a verified connection (#133): its warnings are
  // surfaced on the card, never collected as an acknowledgement, and never a
  // reason to withhold anything. WHETHER this role is verified is read from the
  // evidence the state persists — the same predicate the Review gate reads
  // (#146) — never from the transient status a remount resets.
  const isVerified = isConnectionUsable(roleState);

  return {
    verification: displayVerification,
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
