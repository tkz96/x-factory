// src/frontend/hooks/useAppEvents.ts — Hook for app-wide event stream and consistent snapshot (#257, spec #241).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AppEventEnvelope, EventsSnapshot } from "../../shared/types.js";
import {
  type AppEventTransport,
  defaultAppEventTransport,
  fetchEventsSnapshot,
  subscribeAppEvents,
} from "../lib/app-events.js";
import { queryKeys } from "../lib/query-policies.js";

export interface UseAppEventsOptions {
  transport?: AppEventTransport | undefined;
  onEvent?: ((envelope: AppEventEnvelope) => void) | undefined;
  enabled?: boolean | undefined;
}

/**
 * Hook for consuming the app-wide event stream and snapshot (#257, spec #241).
 * Loads initial consistent snapshot from SQLite, then subscribes from the snapshot cursor.
 */
export function useAppEvents(options?: UseAppEventsOptions) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const enabled = options?.enabled ?? true;

  const snapshotQuery = useQuery<EventsSnapshot>({
    queryKey: queryKeys.eventsSnapshot(),
    queryFn: fetchEventsSnapshot,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const snapshot = snapshotQuery.data;
  const cursor = snapshot?.cursor;

  useEffect(() => {
    if (!enabled || cursor === undefined) return;
    return subscribeAppEvents({
      queryClient,
      initialCursor: cursor,
      transport: options?.transport ?? defaultAppEventTransport,
      onEvent: options?.onEvent,
      onConnectionChange: setConnected,
    });
  }, [enabled, cursor, queryClient, options?.transport, options?.onEvent]);

  return {
    snapshot,
    cursor,
    isLoading: snapshotQuery.isLoading,
    error: snapshotQuery.error,
    connected,
  };
}
