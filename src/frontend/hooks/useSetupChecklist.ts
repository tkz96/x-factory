// src/frontend/hooks/useSetupChecklist.ts — The welcome's read region (#269,
// spec #241).
//
// One region over the four facts the checklist needs: the projects, the runs,
// the settings' roles and the model connections. Each is read from the cache the
// rest of the app already keeps live, so a step ticks itself the moment the
// state behind it changes (the add-project assistant, Settings › Models and
// Start Run all invalidate these keys).
//
// Loading is only reported while a part of the setup has no answer yet, and an
// error never hides a step behind a guess: the region shows the canonical error
// and a retry, and the ticks that are not there stay unticked.

import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import type {
  AsyncQueryLike,
  DerivedAsyncState,
} from "../components/feedback/types.js";
import {
  deriveSetupChecklist,
  type SetupChecklist,
} from "../lib/setup-checklist.js";
import { useModelConnections } from "./useModelConnections.js";
import { useProjects, useRuns, useSettings } from "./useQueries.js";

/**
 * The four queries as one region: ready only once every part of the setup has
 * answered, erroring when any part failed, and never ready-on-partial-data
 * (a tick must not appear before the state behind it is known).
 */
function combineSetupQueries(
  queries: readonly AsyncQueryLike[],
): AsyncQueryLike {
  const failed = queries.find((query) => query.isError);
  return {
    data: queries.every((query) => query.data !== undefined) ? true : undefined,
    isPending: queries.some((query) => query.isPending),
    isError: failed !== undefined,
    error: failed?.error ?? null,
  };
}

export interface SetupChecklistRegion {
  /** Handed to `AsyncRegion`; the region never sees a query. */
  readonly derived: DerivedAsyncState;
  /** The checklist for the state on screen, ticks included. */
  readonly checklist: SetupChecklist;
  /** Retries every part of the setup at once. */
  readonly refetch: () => void;
}

export function useSetupChecklist(): SetupChecklistRegion {
  const projectsQuery = useProjects();
  const runsQuery = useRuns();
  const settingsQuery = useSettings();
  const connectionsQuery = useModelConnections();
  const queries = [
    projectsQuery,
    runsQuery,
    settingsQuery,
    connectionsQuery,
  ] as const;

  return {
    derived: deriveAsyncState(combineSetupQueries(queries)),
    checklist: deriveSetupChecklist({
      projects: projectsQuery.data ?? [],
      runs: runsQuery.data ?? [],
      connections: connectionsQuery.data ?? [],
      roles: settingsQuery.data?.roles,
    }),
    refetch: () => {
      for (const query of queries) void query.refetch();
    },
  };
}
