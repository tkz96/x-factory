// src/frontend/hooks/useRunDetail.ts — A run's snapshot, live events and connection state (#191).
// The event log and the reducer live in lib/run-state.ts; this hook only wires them to React.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TERMINAL_RUN_STATUSES } from "../../shared/run-status-policy.js";
import type { Run, RunEvent } from "../../shared/types.js";
import { queryKeys } from "../lib/query-policies.js";
import { runPollIntervalMs, subscribeRunEvents } from "../lib/run-state.js";
import { useRun } from "./useQueries.js";

const NO_EVENTS: RunEvent[] = [];

export function useRunDetail(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  const runQuery = useRun(runId, {
    refetchInterval: (query) => runPollIntervalMs(query.state.data),
  });
  const run: Run | undefined = runQuery.data;
  const loaded = Boolean(run);
  const terminal = run ? TERMINAL_RUN_STATUSES.has(run.status) : false;

  const eventsQuery = useQuery<RunEvent[]>({
    queryKey: queryKeys.runEvents(runId ?? ""),
    queryFn: () => [],
    enabled: Boolean(runId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  // A finished run is subscribed in replay-only mode, so its history stays visible.
  useEffect(() => {
    if (!runId || !loaded) return;
    return subscribeRunEvents({
      queryClient,
      runId,
      replayOnly: terminal,
      onConnectionChange: setConnected,
    });
  }, [runId, loaded, terminal, queryClient]);

  return {
    run,
    isLoading: runQuery.isLoading,
    error: runQuery.error,
    events: eventsQuery.data ?? NO_EVENTS,
    connected,
  };
}
