// src/frontend/wizard/steps/useRepositoryDiscovery.ts — Discovery query and
// selection lifecycle for the Repositories step (spec #133, ticket #144).
//
// The repository list comes EXCLUSIVELY from the git-host connection's
// discovery capability through the api-client seam: no local git scan, no
// hardcoded list, no manual entry. The query key carries a fingerprint of the
// connection's provider id and config values, so a config edit is a different
// key — a fresh fetch, never the previous configuration's data.
//
// Staleness is INPUT staleness (#132), derived from plain state, never
// TanStack Query's cache-freshness `isStale`:
//   - the displayed result was fetched for a fingerprint that is no longer
//     current, or
//   - the recorded selection was made under a connection that has since
//     changed (survives reloads and step round-trips).
// Either way the step is blocked until the selection is made again.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isNormalizedError } from "../../components/feedback/copy-map.js";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import type { ProviderRepository } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";
import {
  APPLICATION_REPOSITORY_ROLE,
  gitHostDiscoveryFingerprint,
  isApplicationRepository,
  isRepositorySelectionStale,
} from "../state/repositoryRules.js";
import { useWizard } from "../state/wizardContext.js";
import type { WizardRepoConfig } from "../types.js";

/** One discovered repository, tagged with the roles it was listed under. */
export interface RepositoryRow extends ProviderRepository {
  /** Connection roles this repository was listed under. */
  readonly listedUnderRoles: readonly string[];
  /** True when the repository can serve as an application repository. */
  readonly isApplication: boolean;
}

export function useRepositoryDiscovery() {
  const { state, dispatch, canAdvance, nextStep, prevStep } = useWizard();
  const gitHost = state.connect.gitHost;
  const providerId = gitHost.providerId;
  const config = gitHost.config ?? {};
  const requestFingerprint = gitHostDiscoveryFingerprint(state);

  const query = useQuery({
    queryKey: queryKeys.providerRepositories(providerId, config),
    enabled: providerId !== null,
    // A config edit keeps the previous results on screen while the new fetch
    // runs — flagged out of date rather than silently mistaken for current.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (providerId === null) {
        // Unreachable: the region is disabled without a git-host connection.
        throw new Error("Repository discovery requires a git-host connection.");
      }
      const envelope = await api.providers.listRepositories({
        providerId,
        role: "gitHost",
        config,
      });
      if (isNormalizedError(envelope)) {
        // A normalized envelope is the provider's failure channel, not a list.
        throw envelope;
      }
      return { requestFingerprint, envelope };
    },
    ...QUERY_POLICIES.providerRepositories,
  });

  const envelope = query.data?.envelope;
  const listedUnderRoles =
    envelope !== undefined && envelope.roles.length > 0
      ? envelope.roles
      : [APPLICATION_REPOSITORY_ROLE];
  const rows: RepositoryRow[] = (envelope?.repositories ?? []).map((repo) => ({
    ...repo,
    listedUnderRoles,
    isApplication: isApplicationRepository({
      role: listedUnderRoles[0] ?? APPLICATION_REPOSITORY_ROLE,
      roles: [...listedUnderRoles],
    }),
  }));

  const resultIsStale =
    query.data !== undefined &&
    query.data.requestFingerprint !== requestFingerprint;
  const selectionIsStale = isRepositorySelectionStale(state);

  const unconfirmedCapabilities: readonly string[] =
    gitHost.unconfirmedCapabilities ?? [];
  const discoveryUnconfirmed =
    unconfirmedCapabilities.includes("listRepositories");

  const derived = deriveAsyncState(query, {
    isEmpty: () => query.data !== undefined && rows.length === 0,
    isPartial: () => discoveryUnconfirmed,
    isStale: () => resultIsStale || selectionIsStale,
  });

  const toggleRepository = (row: RepositoryRow) => {
    // An out-of-date selection is never extended: choosing a repository after a
    // connection change starts a selection that belongs to the current
    // connection, so a previous connection's ids can never be blessed.
    const baseIds = selectionIsStale ? [] : state.repositories.selectedRepoIds;
    const alreadySelected = baseIds.includes(row.id);
    const nextIds = alreadySelected
      ? baseIds.filter((id) => id !== row.id)
      : [...baseIds, row.id];
    const nextConfigs: Record<string, WizardRepoConfig> = selectionIsStale
      ? {}
      : { ...state.repositories.repoConfigs };
    if (alreadySelected) {
      delete nextConfigs[row.id];
    } else {
      nextConfigs[row.id] = {
        role: row.listedUnderRoles[0] ?? APPLICATION_REPOSITORY_ROLE,
        roles: [...row.listedUnderRoles],
      };
    }

    dispatch({
      type: "UPDATE_REPOSITORIES",
      patch: {
        selectedRepoIds: nextIds,
        repoConfigs: nextConfigs,
        primaryRepoId: nextIds[0] ?? null,
        selectionFingerprint: nextIds.length > 0 ? requestFingerprint : null,
      },
    });
  };

  const restartSelection = () => {
    dispatch({
      type: "UPDATE_REPOSITORIES",
      patch: {
        selectedRepoIds: [],
        repoConfigs: {},
        primaryRepoId: null,
        selectionFingerprint: null,
      },
    });
  };

  return {
    rows,
    derived,
    selectedRepoIds: state.repositories.selectedRepoIds,
    selectionIsStale,
    unconfirmedCapabilities,
    refresh: () => {
      void query.refetch();
    },
    toggleRepository,
    restartSelection,
    canAdvance,
    nextStep,
    prevStep,
  };
}
