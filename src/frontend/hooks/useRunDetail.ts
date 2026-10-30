// src/frontend/hooks/useRunDetail.ts — A run's snapshot, live events and connection state (#191).
// Every decision lives in lib/run-state.ts; this hook only binds it to React.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  const [reconnecting, setReconnecting] = useState(false);
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

  // The subscription depends on the run's id and whether the snapshot is loaded.
  // It does not restart when the run becomes terminal (#317).
  const loaded = plan !== null;
  // Whether the run was finished when its stream first opened: kept per run, so a later status
  // change does not reopen the stream and another run does not inherit it.
  const replayRef = useRef<{ runId: string; replayOnly: boolean } | null>(null);
  if (loaded && plan && replayRef.current?.runId !== runId) {
    replayRef.current = { runId: runId ?? "", replayOnly: plan.replayOnly };
  }

  useEffect(() => {
    if (!runId || !loaded) return;
    return subscribeRunEvents({
      queryClient,
      runId,
      replayOnly: replayRef.current?.replayOnly ?? false,
      onConnectionChange: (live) => {
        setConnected(live);
        if (live) setOpenedRunId(runId);
      },
      onReconnectingChange: (isReconnecting) => {
        setReconnecting(isReconnecting);
      },
    });
  }, [runId, loaded, queryClient]);

  const eventsLoaded =
    (Boolean(runId) && openedRunId === runId) || events.length > 0;

  return {
    run: runQuery.data,
    isLoading: runQuery.isLoading,
    error: runQuery.error,
    events,
    connected,
    reconnecting,
    eventsLoaded,
  };
}
