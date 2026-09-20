// src/frontend/hooks/useQueries.ts — Typed TanStack Query hooks using defined freshness policies (XFM-40, XFM-41, XFM-43).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Run, Ticket } from "../../shared/types.js";
import {
  api,
  type ReadinessData,
  type SettingsData,
} from "../lib/api-client.js";
import {
  invalidateRun,
  invalidateRuns,
  invalidateSettings,
} from "../lib/query-client.js";
import { QUERY_POLICIES, queryKeys } from "../lib/query-policies.js";

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: queryKeys.projects(),
    queryFn: () => api.getProjects(),
    ...QUERY_POLICIES.projects,
  });
}

export function useProject(id: string | null | undefined) {
  return useQuery<Project>({
    queryKey: queryKeys.project(id ?? ""),
    queryFn: () => {
      if (!id) throw new Error("Project ID is required");
      return api.getProject(id);
    },
    enabled: Boolean(id),
    ...QUERY_POLICIES.projects,
  });
}

export function useTickets(projectId: string | null | undefined) {
  return useQuery<Ticket[]>({
    queryKey: queryKeys.tickets(projectId ?? ""),
    queryFn: () => {
      if (!projectId) return [];
      return api.getTickets(projectId);
    },
    enabled: Boolean(projectId),
    ...QUERY_POLICIES.tickets,
  });
}

export function useRuns() {
  return useQuery<Run[]>({
    queryKey: queryKeys.runs(),
    queryFn: () => api.getRuns(),
    ...QUERY_POLICIES.runs,
  });
}

export function useRun(runId: string | null | undefined) {
  return useQuery<Run>({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => {
      if (!runId) throw new Error("Run ID is required");
      return api.getRun(runId);
    },
    enabled: Boolean(runId),
    ...QUERY_POLICIES.run,
  });
}

export function useSettings() {
  return useQuery<SettingsData>({
    queryKey: queryKeys.settings(),
    queryFn: () => api.getSettings(),
    ...QUERY_POLICIES.settings,
  });
}

export function useReadiness() {
  return useQuery<ReadinessData>({
    queryKey: queryKeys.readiness(),
    queryFn: () => api.getReadiness(),
    ...QUERY_POLICIES.readiness,
  });
}

// ─── Mutation Hooks (Targeted Invalidation XFM-43) ───────────────────────────

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createRun>[0]) =>
      api.createRun(payload),
    onSuccess: (newRun) => {
      // Invalidate runs list so new run appears
      void invalidateRuns(queryClient);
      // Prepopulate the single run cache
      queryClient.setQueryData(queryKeys.run(newRun.id), newRun);
    },
  });
}

export function useResumeRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.resumeRun(runId),
    onSuccess: (data) => {
      void invalidateRuns(queryClient);
      queryClient.setQueryData(queryKeys.run(data.run.id), data.run);
    },
  });
}

export function useAbandonRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason?: string }) =>
      api.abandonRun(runId, reason),
    onSuccess: (data) => {
      void invalidateRuns(queryClient);
      queryClient.setQueryData(queryKeys.run(data.run.id), data.run);
    },
  });
}

export function useSteerRun() {
  return useMutation({
    mutationFn: ({ runId, message }: { runId: string; message: string }) =>
      api.steerRun(runId, message),
  });
}

export function useStopRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.stopRun(runId),
    onSuccess: (data) => {
      void invalidateRuns(queryClient);
      queryClient.setQueryData(queryKeys.run(data.run.id), data.run);
    },
  });
}

export function usePrRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId }: { runId: string }) => api.prRun(runId),
    onSuccess: (_, variables) => {
      void invalidateRun(variables.runId, queryClient);
      void invalidateRuns(queryClient);
    },
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.saveSettings>[0]) =>
      api.saveSettings(payload),
    onSuccess: () => {
      void invalidateSettings(queryClient);
    },
  });
}

export function useDiagnostics() {
  return useQuery({
    queryKey: queryKeys.diagnostics(),
    queryFn: () => api.getDiagnostics(),
    ...QUERY_POLICIES.diagnostics,
  });
}
