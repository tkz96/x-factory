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
  return api<{ resolvedPath: string; existsLocally: boolean }>(
    "POST",
    "/discovery/validate-path",
    { path: targetPath },
  );
}

export async function testTrackerConnectionApi(payload: {
  provider: string;
  orgUrl?: string | undefined;
  project?: string | undefined;
  pat?: string | undefined;
}): Promise<AzureConnectionResult> {
  return api<AzureConnectionResult>(
    "POST",
    "/discovery/test-connection",
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
  return api<DiscoveredRepo[]>("POST", "/discovery/repositories", payload);
}

export async function inspectRepoApi(
  path: string,
  name: string,
): Promise<{ readiness: RepositoryReadiness }> {
  return api<{ readiness: RepositoryReadiness }>(
    "POST",
    "/inspection/quick-inspect",
    { path, name },
  );
}
