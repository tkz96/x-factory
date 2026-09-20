// src/frontend/lib/query-policies.ts — Explicit TanStack Query freshness policies (XFM-41).

export const queryKeys = {
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  tickets: (projectId: string) => ["tickets", projectId] as const,
  runs: () => ["runs"] as const,
  run: (runId: string) => ["runs", runId] as const,
  settings: () => ["settings"] as const,
  readiness: () => ["readiness"] as const,
  diagnostics: () => ["diagnostics"] as const,
};

export const QUERY_POLICIES = {
  // Settings: Slow-changing static configuration — fetch once, invalidate on change
  settings: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  },

  // Projects: Low-frequency configuration changes
  projects: {
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },

  // Tickets: Moderate churn from external trackers
  tickets: {
    staleTime: 60 * 1000, // 60 seconds
    refetchOnWindowFocus: false,
  },

  // Runs collection: Dynamic polling baseline (complemented by SSE)
  runs: {
    staleTime: 15 * 1000, // 15 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },

  // Single Run Detail: Real-time SSE updates patch the cache directly; fallback 10s
  run: {
    staleTime: 10 * 1000, // 10 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },

  // Readiness diagnostics
  readiness: {
    staleTime: 60 * 1000, // 60 seconds
    refetchOnWindowFocus: false,
  },

  // System runtime diagnostics (XFM-70)
  diagnostics: {
    staleTime: 10 * 1000, // 10 seconds
    refetchOnWindowFocus: true,
  },
};
