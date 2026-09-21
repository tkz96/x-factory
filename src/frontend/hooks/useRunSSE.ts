// src/frontend/hooks/useRunSSE.ts — Real-time SSE subscriber patching TanStack Query cache directly (XFM-42).

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
  PullRequest,
  ReviewResult,
  Run,
  RunStatus,
  VerificationResult,
} from "../../shared/types.js";
import { patchRunCache } from "../lib/query-client.js";

const TERMINAL_STATUSES = new Set<RunStatus>([
  "pr_created",
  "failed",
  "stopped",
]);

export interface CanonicalWireEvent {
  id: number;
  type: string;
  payload: unknown;
  timestamp: string;
}

export function useRunSSE(run: Run | undefined | null) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<CanonicalWireEvent[]>([]);
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
        const wireEvent = JSON.parse(e.data) as CanonicalWireEvent;
        if (!wireEvent || typeof wireEvent.id !== "number") {
          return;
        }

        setEvents((prev) => {
          if (prev.some((item) => item.id === wireEvent.id)) {
            return prev;
          }
          return [...prev, wireEvent];
        });

        if (wireEvent.type === "status") {
          const payload = wireEvent.payload as {
            status?: RunStatus;
            text?: string;
            pullRequest?: PullRequest;
          } | null;

          if (payload?.status) {
            if (payload.status === "pr_created") {
              patchRunCache(
                runId,
                {
                  status: "pr_created",
                  pullRequest: payload.pullRequest ?? null,
                },
                queryClient,
              );
              queryClient.invalidateQueries({ queryKey: ["run", runId] });
            } else {
              patchRunCache(runId, { status: payload.status }, queryClient);
            }
          }
        } else if (wireEvent.type === "verification") {
          const payload = wireEvent.payload as {
            result?: VerificationResult;
          } | null;
          if (payload?.result) {
            patchRunCache(runId, { verification: payload.result }, queryClient);
          }
        } else if (wireEvent.type === "review") {
          const payload = wireEvent.payload as { result?: ReviewResult } | null;
          if (payload?.result) {
            patchRunCache(runId, { review: payload.result }, queryClient);
          }
        }
      } catch {
        // Non-JSON or keepalive comment
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      // Do not call eventSource.close() here to allow browser native reconnect logic
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, [runId, isTerminal, queryClient]);

  return { events, connected };
}
