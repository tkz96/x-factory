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

import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitIdentityScope } from "../../../shared/types.js";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import type { DerivedAsyncState } from "../../components/feedback/types.js";
import { api } from "../../lib/api-client.js";
import {
  deriveInspectionStatus,
  type InspectionStatus,
  inspectionInputsFingerprint,
  inspectionTargets,
} from "../state/inspectionRules.js";
import { useWizard } from "../state/wizardContext.js";
import { useRepositoryDiscovery } from "./useRepositoryDiscovery.js";

/**
 * Thrown when configuring multiple repositories succeeds for some but fails for others (#161).
 */
export class PartialConfigureError extends Error {
  constructor(
    public readonly configuredPaths: string[],
    public readonly failedPaths: string[],
    cause?: unknown,
  ) {
    super(
      "Partial git identity configuration failure.",
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "PartialConfigureError";
  }
}

export interface InspectionView {
  /** Derived region state for the feedback primitives. */
  derived: DerivedAsyncState;
  /** Everything derived about the recorded inspection. */
  status: InspectionStatus;
  /** Human labels of the repositories whose directory resolved no identity. */
  unresolvedRepoLabels: string[];
  /** Reads the configured git identity again, for the current inputs. */
  inspectAgain: () => void;
  isEmptySelection: boolean;
  /** Configures git identity directly in the inspected scope (#161). */
  configureIdentity: (params: {
    name: string;
    email: string;
    scope?: GitIdentityScope;
  }) => Promise<void>;
  isConfiguring: boolean;
  configureError: unknown;
}

export function useInspection(): InspectionView {
  const { state, dispatch } = useWizard();
  const { rows } = useRepositoryDiscovery();
  const [error, setError] = useState<unknown>(null);
  const [isPending, setIsPending] = useState(false);
  const generationRef = useRef(0);

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
      // The project-level identity is the one read for the directory of the
      // primary selection (or, failing that, the first selected repository):
      // that is the identity the created project commits with.
      const primaryId = primaryRepoId ?? selectedRepoIds[0];
      const primary =
        results.find((result) =>
          result.target.repoIds.includes(primaryId ?? ""),
        ) ?? results[0];
      const unresolvedPaths = [
        ...new Set(
          results
            .filter((result) => result.response.gitIdentity === undefined)
            .map((result) => result.target.path),
        ),
      ];

      const unresolvedResults = results.filter(
        (result) => result.response.gitIdentity === undefined,
      );
      const targetsToCheck =
        unresolvedResults.length > 0
          ? unresolvedResults
          : primary
            ? [primary]
            : [];
      const blockingResult = targetsToCheck.find(
        (r) => !r.response.isGitRepo || r.response.isRepositoryRoot !== true,
      );
      const canUseLocalScope =
        blockingResult === undefined && targetsToCheck.length > 0;
      const blockingLocalPath = blockingResult?.target.path;
      const isBlockingPathRepo = blockingResult?.response.isGitRepo ?? false;

      dispatch({
        type: "UPDATE_INSPECTION",
        patch: {
          gitIdentity: primary?.response.gitIdentity,
          unresolvedRepoIds: results.flatMap((result) =>
            result.response.gitIdentity === undefined
              ? result.target.repoIds
              : [],
          ),
          inputsFingerprint: fingerprint,
          inspectedPath: primary?.target.path,
          isGitRepo: primary?.response.isGitRepo,
          topLevelDir: primary?.response.topLevelDir,
          unresolvedPaths,
          canUseLocalScope,
          blockingLocalPath,
          isBlockingPathRepo,
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
      isPartial: () => status.partial,
      isStale: () => status.stale,
    },
  );

  const unresolvedRepoLabels = (record?.unresolvedRepoIds ?? []).map(
    (id) => rows.find((row) => row.id === id)?.name ?? id,
  );

  const configureMutation = useMutation({
    mutationFn: async ({
      name,
      email,
      scope = "local",
    }: {
      name: string;
      email: string;
      scope?: GitIdentityScope;
    }) => {
      const primaryPath = status.record?.inspectedPath ?? workspacePath;
      if (scope === "global") {
        await api.configureGitIdentity({
          path: primaryPath,
          name,
          email,
          scope: "global",
        });
      } else {
        const pathsToConfigure =
          status.record?.unresolvedPaths &&
          status.record.unresolvedPaths.length > 0
            ? status.record.unresolvedPaths
            : [primaryPath];
        const configuredPaths: string[] = [];
        let firstError: unknown = null;

        for (const targetPath of pathsToConfigure) {
          try {
            await api.configureGitIdentity({
              path: targetPath,
              name,
              email,
              scope: "local",
            });
            configuredPaths.push(targetPath);
          } catch (err) {
            firstError = err;
            break;
          }
        }

        const remainingFailed = pathsToConfigure.filter(
          (p) => !configuredPaths.includes(p),
        );

        if (remainingFailed.length > 0) {
          if (configuredPaths.length > 0) {
            throw new PartialConfigureError(
              configuredPaths,
              remainingFailed,
              firstError,
            );
          }
          throw firstError;
        }
      }
    },
    onSettled: async () => {
      await inspect();
    },
  });

  const configureIdentity = useCallback(
    async (params: {
      name: string;
      email: string;
      scope?: GitIdentityScope;
    }) => {
      try {
        await configureMutation.mutateAsync(params);
      } catch {
        // error stored in configureMutation.error
      }
    },
    [configureMutation],
  );

  return {
    derived,
    status,
    unresolvedRepoLabels,
    inspectAgain: () => {
      void inspect();
    },
    isEmptySelection: selectedRepoIds.length === 0,
    configureIdentity,
    isConfiguring: configureMutation.isPending,
    configureError: configureMutation.error,
  };
}
