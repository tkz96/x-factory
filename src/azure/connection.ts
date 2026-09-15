// src/azure/connection.ts — Azure DevOps connection testing and repository probing domain service.

import { formatAzureAuthHeader, resolveAzureAuthHeader } from "./auth.js";
import { extractAzureDevOpsInfo } from "../discovery/azure.js";

export interface AzureConnectionResult {
  ok: boolean;
  provider: "azure";
  organization?: string;
  project?: string;
  repoCount?: number;
  repositories?: string[];
  authMethod?: string;
  message?: string;
  error?: string;
}

export interface AzureConnectionInput {
  orgUrl?: string;
  project?: string;
  pat?: string;
}

function parseAzureTarget(data: { orgUrl?: string; project?: string }): { orgUrl: string; project: string } | null {
  const parsed = extractAzureDevOpsInfo(data.project || data.orgUrl);
  const orgUrl = (data.orgUrl || parsed.orgUrl || "").trim().replace(/\/+$/, "");
  const project = (parsed.project || data.project || "").trim();
  return orgUrl && project ? { orgUrl, project } : null;
}

async function resolveAzureAuthInfo(pat?: string): Promise<{ authHeader: string; authMethod: string }> {
  if (pat && pat.trim()) {
    return { authHeader: formatAzureAuthHeader(pat), authMethod: "Personal Access Token" };
  }
  const cliHeader = await resolveAzureAuthHeader();
  return { authHeader: cliHeader, authMethod: cliHeader ? "Active Azure CLI Session" : "" };
}

async function fetchAzureRepoNames(apiUrl: string, authHeader: string): Promise<string[]> {
  const res = await fetch(apiUrl, { headers: { Authorization: authHeader, Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Azure responded with status ${res.status}: ${await res.text()}`);
  }
  const resData = (await res.json()) as { value?: Array<{ id: string; name: string }> };
  return (resData.value || []).map((r) => r.name);
}

/**
 * Validate connectivity against Azure DevOps REST API and discover available repositories.
 */
export async function testAzureConnection(data: AzureConnectionInput): Promise<AzureConnectionResult> {
  const target = parseAzureTarget(data);
  if (!target) {
    return {
      ok: false,
      provider: "azure",
      error: "Both Azure Organization URL and Project Name are required (e.g. dev.azure.com/xynotech/Converso).",
    };
  }

  const { authHeader, authMethod } = await resolveAzureAuthInfo((data.pat || "").trim());
  if (!authHeader) {
    return {
      ok: false,
      provider: "azure",
      error: "Authentication required. Please enter an Azure PAT or log in via Azure CLI ('az login').",
    };
  }

  try {
    const apiUrl = `${target.orgUrl}/${encodeURIComponent(target.project)}/_apis/git/repositories?api-version=7.1`;
    const repos = await fetchAzureRepoNames(apiUrl, authHeader);
    return {
      ok: true,
      provider: "azure",
      organization: target.orgUrl,
      project: target.project,
      repoCount: repos.length,
      repositories: repos,
      authMethod,
      message: `Successfully connected to Azure DevOps (${target.project}) via ${authMethod}. Found ${repos.length} repositories.`,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "azure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
