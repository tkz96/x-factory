// src/frontend/lib/query-client.ts — TanStack Query client setup, targeted invalidation & SSE cache patching (XFM-40, XFM-42, XFM-43).

import { QueryClient } from "@tanstack/react-query";
import type { Run } from "../../shared/types.js";
import { ApiError } from "./api-client.js";
import { queryKeys } from "./query-policies.js";

/**
 * Global query retry rule (#163):
 * - Never retry 4xx client errors (and especially not 429 RATE_LIMITED).
 * - Allow at most 1 retry for transient/server errors (5xx, network failures).
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;
  const status =
    error instanceof ApiError
      ? error.status
      : error &&
          typeof error === "object" &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    return false;
  }
  return true;
}

/**
 * Global QueryClient instance with conservative default policies.
 * Explicit policies in query-policies.ts override these per query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
});

// ─── Targeted Invalidation Helpers (XFM-43) ──────────────────────────────────
// Rules: Mutations must only invalidate affected query keys.
// Never call queryClient.invalidateQueries() without key filters.

export async function invalidateProjects(
  client: QueryClient = queryClient,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.projects() });
}

export async function invalidateProject(
  id: string,
  client: QueryClient = queryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.project(id) }),
    client.invalidateQueries({ queryKey: queryKeys.projects() }),
  ]);
}

export async function invalidateTickets(
  projectId: string,
  client: QueryClient = queryClient,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.tickets(projectId) });
}

export async function invalidateRuns(
  client: QueryClient = queryClient,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.runs() });
}

export async function invalidateRun(
  runId: string,
  client: QueryClient = queryClient,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.run(runId) });
}

export async function invalidateSettings(
  client: QueryClient = queryClient,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.settings() });
}

// ─── Direct SSE Cache Patching (XFM-42) ──────────────────────────────────────
// When SSE events arrive (e.g. status transition, diff update, etc.),
// patch the specific run's cache entry directly. Do NOT trigger bulk refetches.

export function patchRunCache(
  runId: string,
  patch: Partial<Run> | ((prev: Run | undefined) => Run | undefined),
  client: QueryClient = queryClient,
): void {
  // 1. Patch the individual run query: ['runs', runId]
  client.setQueryData<Run | undefined>(queryKeys.run(runId), (old) => {
    if (typeof patch === "function") {
      return patch(old);
    }
    if (!old) return undefined;
    return { ...old, ...patch };
  });

  // 2. Patch the matching run in the runs list: ['runs']
  client.setQueryData<Run[] | undefined>(queryKeys.runs(), (oldRuns) => {
    if (!oldRuns) return oldRuns;
    return oldRuns.map((r) => {
      if (r.id !== runId) return r;
      if (typeof patch === "function") {
        const updated = patch(r);
        return updated ?? r;
      }
      return { ...r, ...patch };
    });
  });
}
