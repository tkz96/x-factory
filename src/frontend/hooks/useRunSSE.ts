// src/frontend/hooks/useRunSSE.ts — Real-time SSE subscriber patching TanStack Query cache directly (XFM-42).

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Run, RunEvent } from "../../shared/types.js";
import { patchRunCache } from "../lib/query-client.js";

const TERMINAL_STATUSES = new Set([
  "pr_created",
  "failed",
  "cancelled",
  "recovery_required",
]);

export interface StreamEventItem {
  id: string;
  event: RunEvent;
}

export function useRunSSE(run: Run | undefined | null) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<StreamEventItem[]>([]);
  const [connected, setConnected] = useState(false);

  const runId = run?.id;
  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : false;

  useEffect(() => {
    if (!runId || isTerminal) {
      setConnected(false);
      return;
    }

    const eventSource = new EventSource(
      `/api/runs/${encodeURIComponent(runId)}/events`,
    );

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const rawEvent = JSON.parse(e.data) as RunEvent;
        const eventId = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setEvents((prev) => [...prev, { id: eventId, event: rawEvent }]);

        // Direct cache updates for specific run state transitions (XFM-42)
        if (rawEvent.type === "status") {
          patchRunCache(runId, { status: rawEvent.status }, queryClient);
        } else if (rawEvent.type === "verification") {
          patchRunCache(runId, { verification: rawEvent.result }, queryClient);
        } else if (rawEvent.type === "review") {
          patchRunCache(runId, { review: rawEvent.result }, queryClient);
        }
      } catch {
        // Non-JSON or keepalive comment
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, [runId, isTerminal, queryClient]);

  return { events, connected };
}
