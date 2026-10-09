// src/frontend/hooks/useRunSSE.ts — Real-time SSE subscriber patching TanStack Query cache directly (XFM-42).

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TERMINAL_RUN_STATUSES } from "../../shared/run-status-policy.js";
import type {
  PullRequest,
  ReviewResult,
  Run,
  RunEvent,
  RunStatus,
  VerificationResult,
} from "../../shared/types.js";
import { invalidateRun, patchRunCache } from "../lib/query-client.js";

export type CanonicalWireEvent = RunEvent;

export function useRunSSE(run: Run | undefined | null) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<CanonicalWireEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenEventIdsRef = useRef<Set<number>>(new Set());

  const runId = run?.id;
  const isTerminal = run ? TERMINAL_RUN_STATUSES.has(run.status) : false;

  useEffect(() => {
    seenEventIdsRef.current.clear();
    setEvents([]);

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

        if (seenEventIdsRef.current.has(wireEvent.id)) {
          return;
        }
        seenEventIdsRef.current.add(wireEvent.id);

        setEvents((prev) => [...prev, wireEvent]);

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
            } else {
              patchRunCache(runId, { status: payload.status }, queryClient);
            }
            void invalidateRun(runId, queryClient);
          }
        } else if (wireEvent.type === "verification") {
          const raw = wireEvent.payload as
            | { result?: VerificationResult }
            | VerificationResult
            | null;
          const result =
            raw && typeof raw === "object" && "result" in raw && raw.result
              ? raw.result
              : (raw as VerificationResult | null);

          if (result && typeof result.passed === "boolean") {
            patchRunCache(
              runId,
              {
                verification: result,
                ...(result.diff ? { diff: result.diff } : {}),
                repairAttempts: result.repairAttempt,
              },
              queryClient,
            );
            void invalidateRun(runId, queryClient);
          }
        } else if (wireEvent.type === "review") {
          const raw = wireEvent.payload as
            | { result?: ReviewResult }
            | ReviewResult
            | null;
          const result =
            raw && typeof raw === "object" && "result" in raw && raw.result
              ? raw.result
              : (raw as ReviewResult | null);

          if (result && typeof result.passed === "boolean") {
            patchRunCache(runId, { review: result }, queryClient);
            void invalidateRun(runId, queryClient);
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
