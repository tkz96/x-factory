// src/frontend/wizard/steps/useConnectStep.ts — Orchestration hook for ConnectStep.
//
// The repository URL is collected on step 1 (#268), so this hook owns only what
// step 2 is: the provider manifest read, one connection per role, and the gate
// that both roles verified the configuration on record.

import { useQuery } from "@tanstack/react-query";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import { api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";
import { useWizard } from "../state/wizardContext.js";
import { useRoleConnection } from "./useRoleConnection.js";

export function useConnectStep() {
  const { state, dispatch, nextStep, prevStep } = useWizard();
  const connect = state.connect;
  const { tracker, gitHost } = connect;

  const manifestQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.providers.getManifest(),
    ...QUERY_POLICIES.providers,
  });

  const manifestAsync = deriveAsyncState(manifestQuery);
  const manifest = manifestQuery.data ?? [];

  const trackerConn = useRoleConnection("tracker", connect, dispatch);
  const gitHostConn = useRoleConnection("gitHost", connect, dispatch);

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
    connect,
    trackerConn,
    gitHostConn,
    handleVerifyAll,
    isVerifyingAny,
    canProceed,
    handleNext,
    prevStep,
  };
}
