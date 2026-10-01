// src/frontend/hooks/useRepositoryInspection.ts — Hook for Step 5 repository inspection and readiness (Issue #113).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectRepository } from "../../shared/types.js";
import { api } from "../lib/api-client.js";

export type RepoInspectionStatus =
  | "idle"
  | "inspecting"
  | "ready"
  | "pending_setup"
  | "error"
  | "api_error";

export interface RepoInspectionResult {
  repoId: string;
  status: RepoInspectionStatus;
  message?: string | undefined;
  exists?: boolean | undefined;
  isGitRepo?: boolean | undefined;
  detectedCommands?: Record<string, string> | undefined;
  detectedTooling?: string[] | undefined;
  defaultBranch?: string | undefined;
  apiError?: string | undefined;
}

export interface UseRepositoryInspectionReturn {
  results: Record<string, RepoInspectionResult>;
  isInspecting: boolean;
  hasInspecting: boolean;
  hasApiError: boolean;
  hasConfigError: boolean;
  canAdvance: boolean;
  handleRetrySingle: (repo: ProjectRepository) => Promise<void>;
  handleReinspectAll: () => Promise<void>;
}

async function inspectSingleRepo(
  repo: ProjectRepository,
): Promise<RepoInspectionResult> {
  try {
    const res = await api.inspectRepository({ path: repo.path });
    return {
      repoId: repo.id,
      status: res.readiness.status,
      message: res.readiness.message,
      exists: res.exists,
      isGitRepo: res.isGitRepo,
      detectedCommands: res.detectedCommands,
      detectedTooling: res.detectedTooling,
      defaultBranch: res.defaultBranch,
    };
  } catch (err) {
    return {
      repoId: repo.id,
      status: "api_error",
      apiError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function useRepositoryInspection(
  repositories: ProjectRepository[],
): UseRepositoryInspectionReturn {
  const [results, setResults] = useState<Record<string, RepoInspectionResult>>(
    {},
  );
  const [isInspecting, setIsInspecting] = useState(false);
  const activeInspectionGenRef = useRef(0);

  const runFullInspection = useCallback(
    async (targetRepos: ProjectRepository[], gen: number) => {
      if (targetRepos.length === 0) {
        setResults({});
        setIsInspecting(false);
        return;
      }

      setIsInspecting(true);
      const initial: Record<string, RepoInspectionResult> = {};
      for (const r of targetRepos) {
        initial[r.id] = { repoId: r.id, status: "inspecting" };
      }
      setResults(initial);

      const inspected = await Promise.all(
        targetRepos.map((repo) => inspectSingleRepo(repo)),
      );

      if (activeInspectionGenRef.current !== gen) {
        return;
      }

      const next: Record<string, RepoInspectionResult> = {};
      for (const item of inspected) {
        next[item.repoId] = item;
      }
      setResults(next);
      setIsInspecting(false);
    },
    [],
  );

  useEffect(() => {
    const currentGen = ++activeInspectionGenRef.current;
    void runFullInspection(repositories, currentGen);

    return () => {
      activeInspectionGenRef.current++;
    };
  }, [repositories, runFullInspection]);

  const handleRetrySingle = async (repo: ProjectRepository) => {
    setResults((prev) => ({
      ...prev,
      [repo.id]: { repoId: repo.id, status: "inspecting" },
    }));

    const result = await inspectSingleRepo(repo);
    setResults((prev) => ({
      ...prev,
      [repo.id]: result,
    }));
  };

  const handleReinspectAll = async () => {
    const currentGen = ++activeInspectionGenRef.current;
    await runFullInspection(repositories, currentGen);
  };

  const hasInspecting =
    isInspecting ||
    repositories.some(
      (r) => !results[r.id] || results[r.id]?.status === "inspecting",
    );

  const hasApiError = repositories.some(
    (r) => results[r.id]?.status === "api_error",
  );

  const hasConfigError = repositories.some(
    (r) => results[r.id]?.status === "error",
  );

  const canAdvance =
    repositories.length > 0 &&
    !hasInspecting &&
    !hasApiError &&
    !hasConfigError &&
    repositories.every((r) => {
      const s = results[r.id]?.status;
      return s === "ready" || s === "pending_setup";
    });

  return {
    results,
    isInspecting,
    hasInspecting,
    hasApiError,
    hasConfigError,
    canAdvance,
    handleRetrySingle,
    handleReinspectAll,
  };
}
