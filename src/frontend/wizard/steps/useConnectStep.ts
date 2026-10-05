// src/frontend/wizard/steps/useConnectStep.ts — Orchestration hook for ConnectStep.

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import { api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";
import { useWizard } from "../state/wizardContext.js";
import { useQuickUrlIntake } from "./useQuickUrlIntake.js";
import { useRoleConnection } from "./useRoleConnection.js";

export function useConnectStep() {
  const { state, dispatch, nextStep, prevStep, updateBasics } = useWizard();
  const { tracker, gitHost } = state.connect;

  const parseGenRef = useRef(0);
  const onManualChange = () => {
    parseGenRef.current += 1;
  };

  const manifestQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.providers.getManifest(),
    ...QUERY_POLICIES.providers,
  });

  const manifestAsync = deriveAsyncState(manifestQuery);
  const manifest = manifestQuery.data ?? [];

  const trackerConn = useRoleConnection(
    "tracker",
    tracker,
    dispatch,
    onManualChange,
  );
  const gitHostConn = useRoleConnection(
    "gitHost",
    gitHost,
    dispatch,
    onManualChange,
  );

  const resetRoleVerifications = (roles: ("tracker" | "gitHost")[]) => {
    if (roles.includes("tracker")) {
      trackerConn.resetVerification();
    }
    if (roles.includes("gitHost")) {
      gitHostConn.resetVerification();
    }
  };

  const quickUrlState = useQuickUrlIntake({
    initialUrl: state.connect.quickUrl,
    manifest,
    currentConnect: state.connect,
    basicsName: state.basics.name,
    dispatch,
    updateBasics,
    onResetVerifications: resetRoleVerifications,
    parseGenRef,
  });

  const handleVerifyAll = () => {
    if (tracker.providerId) {
      trackerConn.verify();
    }
    if (gitHost.providerId) {
      gitHostConn.verify();
    }
  };

  const isVerifyingAny = trackerConn.isPending || gitHostConn.isPending;
  const canProceed = trackerConn.isVerified && gitHostConn.isVerified;

  const handleNext = () => {
    if (!canProceed) return;
    nextStep();
  };

  return {
    manifestQuery,
    manifestAsync,
    manifest,
    tracker,
    gitHost,
    trackerConn,
    gitHostConn,
    quickUrlState,
    handleVerifyAll,
    isVerifyingAny,
    canProceed,
    handleNext,
    prevStep,
  };
}
