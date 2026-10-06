// src/frontend/lib/query-policies.ts — Explicit TanStack Query freshness policies (XFM-41).

import type { ProviderDescriptor } from "../connection/types.js";
import { connectionConfigFingerprint } from "./connection-fingerprint.js";

export const queryKeys = {
  projects: (options?: { includeArchived?: boolean }) =>
    options?.includeArchived
      ? (["projects", "list", { archived: true }] as const)
      : (["projects", "list"] as const),
  project: (id: string) => ["projects", "detail", id] as const,
  tickets: (projectId: string) => ["tickets", projectId] as const,
  runs: () => ["runs"] as const,
  run: (runId: string) => ["runs", runId] as const,
  settings: () => ["settings"] as const,
  readiness: () => ["readiness"] as const,
  diagnostics: () => ["diagnostics"] as const,
  providers: () => ["providers", "manifest"] as const,
  /**
   * Repository discovery for a git-host connection (#144). The key carries a
   * fingerprint of the connection's provider id and config values, so editing
   * either one produces a different key — and therefore a fresh fetch instead
   * of the previous configuration's results.
   */
  providerRepositories: (
    providerId: string | null,
    config: Record<string, unknown>,
    descriptorOrDescriptors?:
      | ProviderDescriptor
      | readonly ProviderDescriptor[]
      | ReadonlySet<string>,
  ) =>
    [
      "providers",
      "repositories",
      connectionConfigFingerprint(providerId, config, descriptorOrDescriptors),
    ] as const,
  /**
   * A connection's provider-owned identity (#133 story 34). Keyed by the same
   * non-reversible fingerprint as discovery: the identity belongs to a
   * CONFIGURATION, so an edit is a new key and can never inherit the previous
   * configuration's identity. The configuration itself never enters a key.
   */
  providerIdentity: (
    providerId: string | null,
    config: Record<string, unknown>,
    descriptorOrDescriptors?:
      | ProviderDescriptor
      | readonly ProviderDescriptor[]
      | ReadonlySet<string>,
  ) =>
    [
      "providers",
      "identity",
      connectionConfigFingerprint(providerId, config, descriptorOrDescriptors),
    ] as const,
};

export const QUERY_POLICIES = {
  // Providers: Static configuration from server registry
  providers: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  },

  // Repository discovery: credentials-scoped provider call whose identity IS
  // the connection config — a config edit is a new key (fresh fetch), never a
  // refetch of the previous key. Refreshing is the user's explicit action.
  providerRepositories: {
    staleTime: 60 * 1000, // 60 seconds
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  },

  // Connection identity (#133 story 34): a presentation-only read whose
  // identity IS the connection configuration — a config edit is a new key
  // (fresh fetch), never a refetch of the previous key. Provider-owned, so it
  // changes only when the configuration does; nothing here is persisted.
  providerIdentity: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  },

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
