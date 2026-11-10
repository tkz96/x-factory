// src/frontend/wizard/steps/useInspection.ts — The inspection query lifecycle
// for the Inspection step (spec #133, ticket #146).
//
// The identity is read through the api-client seam, per directory: once for
// each distinct directory the selection is read in (a repository's own local
// path when it has one, otherwise the project's workspace root). The resolved
// result is recorded in wizard state so Review re-shows the SAME value instead
// of re-deriving it — and so the stale rule can compare it against the inputs
// it belongs to.
//
// The read is imperative and generation-guarded, exactly like the Connect
// step's verification: an in-flight read can never overwrite a newer one, and a
// failed read leaves whatever was already shown on screen.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitIdentity } from "../../../shared/types.js";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import type { DerivedAsyncState } from "../../components/feedback/types.js";
import { api } from "../../lib/api-client.js";
import {
  deriveInspectionStatus,
  type InspectionStatus,
  identityAfterRead,
  inspectionInputsFingerprint,
  inspectionTargets,
} from "../state/inspectionRules.js";
import { useWizard } from "../state/wizardContext.js";

export interface InspectionView {
  /** Derived region state for the feedback primitives. */
  derived: DerivedAsyncState;
  /** Everything derived about the recorded inspection. */
  status: InspectionStatus;
  /** Reads the configured git identity again, for the current inputs. */
  inspectAgain: () => void;
  /** Sets the identity chosen for this project. Writes no git config file. */
  setProjectIdentity: (identity: GitIdentity) => void;
}

export function useInspection(): InspectionView {
  const { state, dispatch } = useWizard();
  const [error, setError] = useState<unknown>(null);
  const [isPending, setIsPending] = useState(false);
  const generationRef = useRef(0);
  // The identity on screen as of the latest render, read when a read lands so
  // an edit made while the read was in flight is not overwritten.
  const inspectionRef = useRef(state.inspection);
  inspectionRef.current = state.inspection;

  const status = deriveInspectionStatus(state);
  const { workspacePath } = state.basics;
  const { selectedRepoIds, repoConfigs, primaryRepoId } = state.repositories;

  const inspect = useCallback(async () => {
    const generation = ++generationRef.current;
    const inputs = { workspacePath, selectedRepoIds, repoConfigs };
    const fingerprint = inspectionInputsFingerprint(inputs);
    const targets = inspectionTargets(inputs);
    setIsPending(true);
    setError(null);
    try {
      const results = await Promise.all(
        targets.map(async (target) => ({
          target,
          response: await api.inspectRepository({ path: target.path }),
        })),
      );
      if (generation !== generationRef.current) return;
      // The pre-filled identity is the one read for the directory of the
      // primary selection (or, failing that, the first selected repository):
      // that is the identity a commit there would use.
      const primaryId = primaryRepoId ?? selectedRepoIds[0];
      const primary =
        results.find((result) =>
          result.target.repoIds.includes(primaryId ?? ""),
        ) ?? results[0];
      dispatch({
        type: "UPDATE_INSPECTION",
        patch: {
          gitIdentity: identityAfterRead(
            inspectionRef.current.gitIdentity,
            inspectionRef.current.readIdentity,
            primary?.response.gitIdentity,
          ),
          readIdentity: primary?.response.gitIdentity,
          unresolvedRepoIds: results.flatMap((result) =>
            result.response.gitIdentity === undefined
              ? result.target.repoIds
              : [],
          ),
          inputsFingerprint: fingerprint,
          inspectedPath: primary?.target.path,
          isGitRepo: primary?.response.isGitRepo,
          topLevelDir: primary?.response.topLevelDir,
        },
      });
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err);
      }
    } finally {
      if (generation === generationRef.current) {
        setIsPending(false);
      }
    }
  }, [workspacePath, selectedRepoIds, repoConfigs, primaryRepoId, dispatch]);

  // Read once on arrival — and again whenever the inputs the identity depends
  // on change: a stale identity must never be left on screen as if it were
  // current. A record that is ALREADY current for the current inputs is not
  // re-read: the effect fires on every mount of the step (a back-navigation to
  // Inspection, for example), and firing a second identical request for
  // evidence already on screen is exactly the duplicate-request churn #148's
  // smoothness criterion 6 forbids. `inspect` keeps a stable identity between
  // input changes, so this never re-fires on the state it records.
  const recordIsCurrent = status.record !== null && !status.stale;
  useEffect(() => {
    if (recordIsCurrent) return;
    void inspect();
  }, [inspect, recordIsCurrent]);

  const record = status.record;
  const derived = deriveAsyncState(
    {
      data: record ?? undefined,
      // Loading means "nothing to show yet": with a record on screen, a
      // re-read keeps it visible and flagged rather than blanking the region.
      isPending: isPending && record === null,
      isError: error !== null,
      error,
    },
    {
      isEmpty: () => status.targets.length === 0,
      isStale: () => status.stale,
    },
  );

  const setProjectIdentity = useCallback(
    (identity: GitIdentity) => {
      dispatch({ type: "UPDATE_INSPECTION", patch: { gitIdentity: identity } });
    },
    [dispatch],
  );

  return {
    derived,
    status,
    inspectAgain: () => {
      void inspect();
    },
    setProjectIdentity,
  };
}
