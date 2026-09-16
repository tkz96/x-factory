// public/js/wizard-api.ts — API interactions for onboarding discovery, path validation, and quick inspection.

import type {
  AzureConnectionResult,
  DiscoveredRepo,
  RepositoryReadiness,
} from "../../src/shared/types.js";
import { api } from "./utils.js";

export async function checkWorkspacePathApi(
  targetPath: string,
): Promise<{ resolvedPath: string; existsLocally: boolean }> {
  const res = await api<{
    resolvedPath: string;
    existsLocally?: boolean;
    exists?: boolean;
  }>("POST", "/projects/check-path", { path: targetPath });
  return {
    resolvedPath: res.resolvedPath,
    existsLocally: res.existsLocally ?? res.exists ?? false,
  };
}

export async function testTrackerConnectionApi(payload: {
  provider: string;
  orgUrl?: string | undefined;
  project?: string | undefined;
  pat?: string | undefined;
  host?: string | undefined;
  email?: string | undefined;
  token?: string | undefined;
  repo?: string | undefined;
}): Promise<AzureConnectionResult & { message?: string }> {
  return api<AzureConnectionResult & { message?: string }>(
    "POST",
    "/projects/test-connection",
    payload,
  );
}

export async function runDiscoveryApi(payload: {
  provider: string;
  workspacePath?: string | undefined;
  orgUrl?: string | undefined;
  project?: string | undefined;
  pat?: string | undefined;
}): Promise<DiscoveredRepo[]> {
  const res = await api<DiscoveredRepo[] | { repositories: DiscoveredRepo[] }>(
    "POST",
    "/projects/discover-repositories",
    payload,
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.repositories)) return res.repositories;
  return [];
}

export async function inspectRepoApi(
  path: string,
  name: string,
): Promise<{ readiness: RepositoryReadiness }> {
  const res = await api<{
    readiness?: RepositoryReadiness;
    exists?: boolean;
    isGitRepo?: boolean;
  }>("POST", "/projects/inspect-repository", { path, name });

  if (res.readiness) {
    return { readiness: res.readiness };
  }
  const isReady = Boolean(res.exists && res.isGitRepo);
  return {
    readiness: {
      repositoryId: name,
      isGitRepo: Boolean(res.isGitRepo),
      remoteMatches: true,
      branchDetected: Boolean(res.isGitRepo),
      commandsDetected: false,
      existsLocally: Boolean(res.exists),
      status: isReady ? "ready" : res.exists ? "pending_setup" : "error",
      message: isReady
        ? "Ready"
        : res.exists
          ? "Pending Git init"
          : "Directory missing",
    },
  };
}
