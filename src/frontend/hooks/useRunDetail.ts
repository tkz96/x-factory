// src/frontend/hooks/useRunDetail.ts — A run's snapshot, live events and connection state (#191).
// Every decision lives in lib/run-state.ts; this hook only binds it to React.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { RunEvent } from "../../shared/types.js";
import { queryKeys } from "../lib/query-policies.js";
import {
  runRefetchInterval,
  runStreamPlan,
  subscribeRunEvents,
} from "../lib/run-state.js";
import { useRun } from "./useQueries.js";

const NO_EVENTS: RunEvent[] = [];

export function useRunDetail(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [openedRunId, setOpenedRunId] = useState<string | null>(null);

  const runQuery = useRun(runId, { refetchInterval: runRefetchInterval });
  const plan = runStreamPlan(runQuery.data);

  const eventsQuery = useQuery<RunEvent[]>({
    queryKey: queryKeys.runEvents(runId ?? ""),
    queryFn: () => [],
    enabled: Boolean(runId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const events = eventsQuery.data ?? NO_EVENTS;

  // The subscription depends only on the run's id, whether the snapshot is loaded, and replayOnly.
  const loaded = plan !== null;
  const replayOnly = plan?.replayOnly ?? false;
  useEffect(() => {
    if (!runId || !loaded) return;
    return subscribeRunEvents({
      queryClient,
      runId,
      replayOnly,
      onConnectionChange: (live) => {
        setConnected(live);
        if (live) setOpenedRunId(runId);
      },
    });
  }, [runId, loaded, replayOnly, queryClient]);

  const eventsLoaded =
    (Boolean(runId) && openedRunId === runId) || events.length > 0;

  return {
    run: runQuery.data,
    isLoading: runQuery.isLoading,
    error: runQuery.error,
    events,
    connected,
    eventsLoaded,
  };
}
