// src/discovery/azure.ts — Read-only repository discovery for Azure DevOps.

import { resolveAzureAuthHeader } from "../azure/auth.js";
import { AzureRepoListSchema } from "./schemas.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

interface AzureGitRepoItem {
  id: string;
  name: string;
  url?: string | undefined;
  remoteUrl?: string | undefined;
  webUrl?: string | undefined;
  defaultBranch?: string | undefined;
}

export function extractAzureDevOpsInfo(value?: string | undefined): {
  orgUrl?: string | undefined;
  project?: string | undefined;
  repo?: string | undefined;
} {
  if (!value) return {};
  const trimmed = value.trim();

  // dev.azure.com/org/project(/_git/repo)?
  const devAzureMatch = trimmed.match(
    /^(?:https?:\/\/)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/([^/]+))?/i,
  );
  if (devAzureMatch?.[1] && devAzureMatch[2]) {
    return {
      orgUrl: `https://dev.azure.com/${devAzureMatch[1]}`,
      project: decodeURIComponent(devAzureMatch[2]),
      repo: devAzureMatch[3] ? decodeURIComponent(devAzureMatch[3]) : undefined,
    };
  }

  // ssh.dev.azure.com:v3/org/project/repo
  const sshAzureMatch = trimmed.match(
    /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
  );
  if (sshAzureMatch?.[1] && sshAzureMatch[2] && sshAzureMatch[3]) {
    return {
      orgUrl: `https://dev.azure.com/${sshAzureMatch[1]}`,
      project: decodeURIComponent(sshAzureMatch[2]),
      repo: decodeURIComponent(sshAzureMatch[3]),
    };
  }

  // org.visualstudio.com/project(/_git/repo)?
  const vsMatch = trimmed.match(
    /^(?:https?:\/\/)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/([^/]+))?/i,
  );
  if (vsMatch?.[1] && vsMatch[2]) {
    return {
      orgUrl: `https://${vsMatch[1]}.visualstudio.com`,
      project: decodeURIComponent(vsMatch[2]),
      repo: vsMatch[3] ? decodeURIComponent(vsMatch[3]) : undefined,
    };
  }

  // org/project format
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/);
  if (
    simpleMatch?.[1] &&
    simpleMatch[2] &&
    !trimmed.includes("github.com") &&
    !trimmed.includes("gitlab.com")
  ) {
    return {
      orgUrl: `https://dev.azure.com/${simpleMatch[1]}`,
      project: simpleMatch[2],
    };
  }

  return {};
}

function pickFirst(...items: (string | undefined)[]): string {
  for (const item of items) {
    if (item?.trim()) return item.trim();
  }
  return "";
}

interface ResolvedAzureParams {
  orgUrl: string;
  project: string;
  authHeader: string;
}

function extractTarget(input: RepositoryDiscoveryInput) {
  const candidate = input.primaryRepo || input.project || input.orgUrl;
  return extractAzureDevOpsInfo(candidate);
}

function resolvePat(inputPat?: string, savedPat?: string): string {
  if (typeof inputPat === "string") return inputPat.trim();
  return savedPat ? savedPat.trim() : "";
}

async function resolveAzureParams(
  input: RepositoryDiscoveryInput,
): Promise<ResolvedAzureParams> {
  const parsed = extractTarget(input);
  const orgUrl = pickFirst(
    input.orgUrl,
    parsed.orgUrl,
    process.env.AZURE_DEVOPS_ORG_URL,
  ).replace(/\/+$/, "");
  const project = pickFirst(
    input.project,
    parsed.project,
    process.env.AZURE_DEVOPS_PROJECT,
  );
  const pat = resolvePat(input.pat, process.env.AZURE_DEVOPS_PAT);

  if (!orgUrl) {
    throw new Error(
      "Azure DevOps Organization URL is required (e.g. https://dev.azure.com/xynotech). Enter it in the discovery form.",
    );
  }
  if (!project) {
    throw new Error(
      "Azure DevOps Project name is required (e.g. Converso). Enter it in the Tracker Project field or provide the full repository URL.",
    );
  }

  const authHeader = await resolveAzureAuthHeader(pat);
  if (!authHeader) {
    throw new Error(
      'Azure DevOps Personal Access Token (PAT) with Code (Read) permission is required to query Azure Repos online. Configure it in Settings (Settings → Trackers) or enter it in the discovery form. Alternatively, choose "Local Workspace Folder" to discover local clones without a PAT.',
    );
  }

  return { orgUrl, project, authHeader };
}

function mapAzureRepoItem(repo: AzureGitRepoItem): DiscoveredRepository {
  const cleanBranch = repo.defaultBranch
    ? repo.defaultBranch.replace(/^refs\/heads\//, "")
    : "main";

  return {
    id: repo.id,
    name: repo.name,
    remote: repo.remoteUrl || repo.url || "",
    defaultBranch: cleanBranch,
    webUrl: repo.webUrl,
  };
}

function isHtmlResponse(contentType: string, text: string): boolean {
  if (contentType.toLowerCase().includes("text/html")) {
    return true;
  }
  const trimmed = text.trimStart().toLowerCase();
  if (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body")
  ) {
    return true;
  }
  return /<(?:!doctype\s+html|html|head|body)[^>]*>/i.test(text);
}

function isHtmlOrXml(text: string): boolean {
  if (isHtmlResponse("", text)) return true;
  return /<[a-z!/][^>]*>/i.test(text);
}

function getStatusPhrase(status: number, statusText?: string): string {
  if (statusText?.trim() && statusText !== "OK") {
    return statusText.trim();
  }
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 408:
      return "Request Timeout";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    case 504:
      return "Gateway Timeout";
    default:
      return "Request failed";
  }
}

function sanitizeHttpError(
  status: number,
  statusText: string,
  bodyText: string,
  contentType: string,
): string {
  const fallback = getStatusPhrase(status, statusText);
  const trimmed = bodyText.trim();

  if (
    !trimmed ||
    isHtmlResponse(contentType, trimmed) ||
    isHtmlOrXml(trimmed)
  ) {
    return `Azure DevOps API error (${status}): ${fallback}`;
  }

  try {
    const data = JSON.parse(trimmed);
    if (data && typeof data === "object") {
      const msg = typeof data.message === "string" ? data.message.trim() : "";
      if (msg && !isHtmlOrXml(msg)) {
        const cleanMsg = msg.replace(/\s+/g, " ").slice(0, 200);
        return `Azure DevOps API error (${status}): ${cleanMsg}`;
      }
    }
  } catch {
    // Not JSON
  }

  if (
    !trimmed.includes("<") &&
    !trimmed.includes(">") &&
    !trimmed.includes("\n") &&
    trimmed.length <= 150
  ) {
    return `Azure DevOps API error (${status}): ${trimmed}`;
  }

  return `Azure DevOps API error (${status}): ${fallback}`;
}

async function fetchAzureApiRepos(
  orgUrl: string,
  project: string,
  authHeader: string,
): Promise<AzureGitRepoItem[]> {
  const apiUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`;
  const res = await fetch(apiUrl, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Azure DevOps project "${project}" was not found at ${orgUrl}.`,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(
      sanitizeHttpError(res.status, res.statusText, bodyText, contentType),
    );
  }

  // Handle HTML login/redirect response on 2xx or 203 (e.g. unauthenticated redirect)
  if (
    res.status === 203 ||
    isHtmlResponse(contentType, bodyText) ||
    (res.redirected &&
      (res.url.includes("login") || res.url.includes("signin")))
  ) {
    throw new Error(
      "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    throw new Error(
      "Azure DevOps Repositories API response validation failed: Malformed JSON response.",
    );
  }

  const parsed = AzureRepoListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Azure DevOps Repositories API response validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data.value ?? [];
}

export class AzureDevOpsRepositoryDiscovery
  implements RepositoryDiscoveryProvider
{
  public readonly provider = "azure";

  async listRepositories(
    input: RepositoryDiscoveryInput,
  ): Promise<DiscoveredRepository[]> {
    const { orgUrl, project, authHeader } = await resolveAzureParams(input);
    const items = await fetchAzureApiRepos(orgUrl, project, authHeader);
    return items.map(mapAzureRepoItem);
  }
}
