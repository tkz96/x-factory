// src/frontend/wizard/steps/useRoleConnection.ts — State and verification lifecycle hook for a connection role.
//
// One instance per ROLE. The instance owns this card's local session state — the
// verification result it just received, the error it just surfaced, whether a
// request is in flight — while everything durable lives in the wizard state: the
// provider selection per role, the configuration per PROVIDER, the GENERATION of
// that configuration, and the verification EVIDENCE per role. A role reads the
// configuration of the provider it selected (so a provider serving both roles is
// read, and written, through one record by both cards).
//
// The session state is transient BY CONSTRUCTION: only the ACTIVE step is
// rendered, so navigating away unmounts this hook and drops it. The EVIDENCE is
// what survives, and it is what answers whether the role is verified
// (correction 5, #133).
//
// WHAT AN ATTEMPT VERIFIED is the configuration GENERATION — the counter the
// reducer bumps on every write to a provider's configuration, from whichever card
// (correction 1, #133). An attempt carries the generation it asked about; the
// reducer records its evidence only while that generation is still current, and
// this hook displays the attempt only under the same condition. A write from the
// OTHER card therefore invalidates the attempt in both places, which a per-card
// counter structurally could not do.

import { useRef, useState } from "react";
import { isConnectionUsable } from "../../components/connections/connection-state.js";
import { isNormalizedError } from "../../components/feedback/copy-map.js";
import type { VerificationResult } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { configGeneration, roleConfig } from "../state/connectConfig.js";
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

/**
 * One verification attempt, tagged with WHAT it verified: the provider it asked
 * about and that provider's configuration generation at the moment the request
 * went out.
 *
 * The tag is what makes a late answer discardable. The generation lives in the
 * wizard state — the authoritative configuration's own counter — so a write from
 * the OTHER card, which this hook's closed-over state can never see, moves the
 * generation just as a write from this card does (correction 1, #133).
 */
interface VerificationAttempt {
  providerId: string;
  generation: number;
  pending: boolean;
  result: VerificationResult | null;
  error: unknown | null;
}

/**
 * True while an attempt still describes the configuration on record for the role
 * it belongs to: the role names that provider, and the provider's configuration
 * is still the generation the attempt asked about. `generation` is read from the
 * CURRENT state, never from the attempt's own closure.
 */
function isAttemptCurrent(
  attempt: VerificationAttempt | null,
  roleState: WizardConnectionRoleState,
  connect: WizardConnectState,
): attempt is VerificationAttempt {
  return (
    attempt !== null &&
    roleState.providerId === attempt.providerId &&
    configGeneration(connect, attempt.providerId) === attempt.generation
  );
}

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
  const [attempt, setAttempt] = useState<VerificationAttempt | null>(null);
  // Which of THIS card's attempts is the newest.
  //
  // This is a DIFFERENT rule from the generation, and both are needed: the
  // generation answers "is the configuration this attempt asked about still on
  // record?" — cross-card, reducer-owned — while this sequence answers "is this
  // the attempt the user last asked for?". A superseded answer is not wrong, it
  // is simply no longer the answer to the question on screen, so it must not
  // write the local payload or the evidence. The shipped card disables its
  // Verify button while an attempt is pending, so today a second attempt would
  // need another caller (the Quick-URL reset path clears a role the same way);
  // the rule makes the hook's behaviour independent of that button state, and is
  // proven directly in `test/role-connection-hook.test.tsx`.
  const attemptSeq = useRef(0);

  const clearAttempt = () => {
    attemptSeq.current += 1;
    setAttempt(null);
  };

  const selectProvider = (providerId: string | null) => {
    clearAttempt();
    onManualChange?.();
    dispatch({ type: "SELECT_PROVIDER", role, providerId });
  };

  const updateConfig = (fieldName: string, value: unknown) => {
    if (!roleState.providerId) return;
    // Clearing the local attempt is for immediacy only: the display below
    // already treats it as absent once the generation moves on, whichever card
    // moved it.
    clearAttempt();
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
    const providerId = roleState.providerId;
    if (!providerId) return;
    // The generation of the configuration this attempt is about, read from the
    // authoritative state as the request goes out. The reducer records the
    // evidence only while the provider still carries that generation.
    const generation = configGeneration(connect, providerId);
    const seq = ++attemptSeq.current;
    setAttempt({
      providerId,
      generation,
      pending: true,
      result: null,
      error: null,
    });
    try {
      const res = await api.providers.verify({
        providerId,
        role,
        // The shared configuration, read at request time: the verification is
        // of what is on record for the provider, never of a per-role copy.
        config: roleConfig(connect, role),
      });
      // A newer attempt on this card, or a reset, superseded this one: report
      // nothing, in either direction.
      if (seq !== attemptSeq.current) {
        return;
      }
      if (isNormalizedError(res)) {
        setAttempt({
          providerId,
          generation,
          pending: false,
          result: null,
          error: res,
        });
        dispatch({
          type: "RECORD_VERIFICATION",
          role,
          providerId,
          generation,
          verified: false,
          unconfirmedCapabilities: [],
          missingScopes: undefined,
        });
      } else {
        setAttempt({
          providerId,
          generation,
          pending: false,
          result: res,
          error: null,
        });
        // Degraded verification is evidence, not an error: persist exactly
        // which contract capabilities could not be confirmed so downstream
        // steps can name the capability they depend on (#129, #144). The
        // verified flag is what survives a step change: the provider accepted
        // the credentials, and a later step can only re-verify it, never
        // re-invent it.
        const missingScopesMap: Record<string, string[]> = {};
        if (res.status === "degraded") {
          for (const w of res.warnings) {
            if (
              w.kind === "CAPABILITY_UNCONFIRMED" &&
              w.missingScopes &&
              w.missingScopes.length > 0
            ) {
              missingScopesMap[w.capability] = [...w.missingScopes];
            }
          }
        }
        const hasMissingScopes = Object.keys(missingScopesMap).length > 0;

        dispatch({
          type: "RECORD_VERIFICATION",
          role,
          providerId,
          generation,
          verified: true,
          unconfirmedCapabilities:
            res.status === "degraded"
              ? res.warnings
                  .filter((w) => w.kind === "CAPABILITY_UNCONFIRMED")
                  .map((w) => w.capability)
              : [],
          missingScopes: hasMissingScopes ? missingScopesMap : undefined,
          ...(res.overPrivileged !== undefined
            ? { overPrivileged: res.overPrivileged }
            : {}),
        });
      }
    } catch (err) {
      if (seq !== attemptSeq.current) {
        return;
      }
      setAttempt({
        providerId,
        generation,
        pending: false,
        result: null,
        error: err,
      });
      dispatch({
        type: "RECORD_VERIFICATION",
        role,
        providerId,
        generation,
        verified: false,
        unconfirmedCapabilities: [],
        missingScopes: undefined,
      });
    }
  };

  const resetVerification = () => {
    clearAttempt();
  };

  // The attempt is shown only while it still describes the configuration on
  // record: a write from EITHER card, a provider change and a Quick-URL match
  // all move the generation on, and a result still in hand then belongs to a
  // configuration nobody verified.
  //
  // This reads the SAME authoritative generation the reducer guards the recorded
  // evidence with (`RECORD_VERIFICATION`), from the same place — the wizard
  // state — so what the card shows can never claim more than the state holds. It
  // is not a second staleness rule: the counter is the one token, and both
  // consumers compare it against the attempt's.
  const currentAttempt = isAttemptCurrent(attempt, roleState, connect)
    ? attempt
    : null;
  const { fieldErrors, formErrors } = extractApiErrors(currentAttempt?.error);
  // The card's displayed evidence is derived from BOTH sources, in one place:
  // the result just received, and the evidence the wizard state persists for
  // this role. The state is authoritative for the FACT — the hook's local state
  // is gone as soon as the step unmounts (only the ACTIVE step is rendered), so
  // a remount must not silently un-verify a role the reducer still records as
  // verified.
  const displayVerification = resolveVerificationDisplay(
    currentAttempt?.result ?? null,
    roleState,
  );
  const sessionStatus = deriveVerificationStatus(
    currentAttempt?.pending ?? false,
    currentAttempt?.result ?? null,
    currentAttempt?.error ?? null,
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
    error: currentAttempt?.error ?? null,
    isPending: currentAttempt?.pending ?? false,
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
