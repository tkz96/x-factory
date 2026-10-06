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
//
// A previous configuration's results may stay on screen while the new key
// fetches (`keepPreviousData`) — but only as content. They are never
// selectable, and Continue never unblocks on them, so an old connection's
// repository id can never be recorded under the current connection's
// fingerprint (#133 correction 4).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { isNormalizedError } from "../../components/feedback/copy-map.js";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import type {
  ProviderRepository,
  RepositoriesEnvelope,
} from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";
import { roleConfig } from "../state/connectConfig.js";
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

/** One discovery request's outcome, tagged with the configuration it was for. */
interface DiscoveryResult {
  readonly requestFingerprint: string;
  readonly envelope: RepositoriesEnvelope;
}

export function useRepositoryDiscovery() {
  const { state, dispatch, canAdvance, nextStep, prevStep } = useWizard();
  const gitHost = state.connect.gitHost;
  const providerId = gitHost.providerId;
  const config = roleConfig(state.connect, "gitHost");
  const requestFingerprint = gitHostDiscoveryFingerprint(state);
  // The last result this region put on screen, kept so content survives a
  // failed refresh of a NEW configuration (#133 correction 4).
  const lastDisplayed = useRef<DiscoveryResult | undefined>(undefined);

  const query = useQuery({
    queryKey: queryKeys.providerRepositories(providerId, config),
    enabled: providerId !== null,
    // A config edit keeps the previous results on screen while the new fetch
    // runs — flagged out of date rather than silently mistaken for current.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DiscoveryResult> => {
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

  // `keepPreviousData` only covers the window where the new fetch is in flight.
  // The moment that fetch FAILS the query has no data and the placeholder is
  // dropped, which would blank the region and lose the list the user was
  // reading — so the last displayed result is held here and shown instead. It
  // is shown as previous-configuration content: `resultIsStale` compares its
  // fingerprint against the current one, so it stays visible and never
  // selectable, next to the failure's diagnostics, which `deriveAsyncState`
  // renders as a suppressed banner over content rather than in place of it.
  if (query.data !== undefined) {
    lastDisplayed.current = query.data;
  }
  const result = query.data ?? lastDisplayed.current;

  const envelope = result?.envelope;
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
    result !== undefined && result.requestFingerprint !== requestFingerprint;
  const selectionIsStale = isRepositorySelectionStale(state);

  // The rows on screen are only ever rows the CURRENT configuration produced.
  // While the fetch for an edited configuration runs, the previous
  // configuration's result stays visible as placeholder content (so the region
  // never collapses to a spinner) — and that is ALL it is: visible. Its ids
  // belong to a connection that is no longer the one being configured, and
  // recording one would stamp it with the current fingerprint, after which
  // every staleness check agrees the selection is current (#133 correction 4).
  const rowsSelectable = !resultIsStale;

  const unconfirmedCapabilities: readonly string[] =
    gitHost.unconfirmedCapabilities ?? [];
  const discoveryUnconfirmed =
    unconfirmedCapabilities.includes("listRepositories");

  const derived = deriveAsyncState(
    {
      data: result,
      isPending: query.isPending,
      isError: query.isError,
      error: query.error,
    },
    {
      isEmpty: () => result !== undefined && rows.length === 0,
      isPartial: () => discoveryUnconfirmed,
      isStale: () => resultIsStale || selectionIsStale,
    },
  );

  const toggleRepository = (row: RepositoryRow) => {
    // Rows produced for a configuration that is no longer current are refused
    // here, not merely disabled in the DOM: the selection a click records is
    // stamped with the CURRENT fingerprint below, so accepting a placeholder
    // row would file an old connection's repository id under the new
    // connection — indistinguishable from a real selection thereafter (#133
    // correction 4).
    if (!rowsSelectable) {
      return;
    }
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

  // The step's Continue must not act on placeholder results. The pure rule
  // (`canAdvanceFromRepositories`) is a function of wizard STATE alone; whether
  // the rows on screen belong to the CURRENT configuration is a query-derived
  // fact, so the fold belongs here — the one place that composes the query with
  // the state. The fingerprint-based staleness model in `repositoryRules.ts` is
  // untouched and keeps blocking on its own.
  const canAdvanceStep = canAdvance && rowsSelectable;

  return {
    rows,
    derived,
    selectedRepoIds: state.repositories.selectedRepoIds,
    selectionIsStale,
    rowsSelectable,
    unconfirmedCapabilities,
    refresh: () => {
      void query.refetch();
    },
    toggleRepository,
    restartSelection,
    canAdvance: canAdvanceStep,
    nextStep,
    prevStep,
  };
}
