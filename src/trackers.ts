import type { Ticket } from "./types.js";
import { execCommand } from "./proc.js";
import { getProject } from "./config.js";
import { loadSettings, type FactorySettings } from "./settings.js";


export const REQUIRED_WORKFLOW_LABEL = "agentic-workflow";

export type TrackerProvider = "github" | "jira" | "azure";

export interface TrackerTicket extends Ticket {
  labels: string[];
  url: string;
  provider: TrackerProvider;
  updatedAt?: string;
}

export interface TrackerOptions {
  provider?: TrackerProvider;
  requiredLabel?: string;
  // GitHub
  githubRepo?: string;
  githubToken?: string;
  // Jira
  jiraHost?: string;
  jiraEmail?: string;
  jiraToken?: string;
  jiraProject?: string;
  // Azure DevOps
  azureOrgUrl?: string;
  azureProject?: string;
  azurePat?: string;
}

function isSectionHeader(line: string): boolean {
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(line);
}

function parseBulletLine(line: string): string | null {
  const match = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match ? sanitizeLine(match[1]) : null;
}

/**
 * Extract structured criteria bullets from description or markdown.
 */
export function extractCriteria(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex(isSectionHeader);

  if (headerIdx >= 0) {
    const sectionLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/^#+\s+/.test(lines[i])) break;
      const bullet = parseBulletLine(lines[i]);
      if (bullet) {
        sectionLines.push(bullet);
      } else if (lines[i].length > 5) {
        sectionLines.push(sanitizeLine(lines[i]));
      }
    }
    return sectionLines;
  }

  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

function sanitizeLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseAdfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") {
    return obj.text;
  }
  if (Array.isArray(obj.content)) {
    const pieces = obj.content.map(parseAdfToText);
    if (obj.type === "bulletList") {
      return pieces.map((p) => `- ${p.trim()}`).join("\n");
    }
    if (obj.type === "paragraph" || obj.type === "heading") {
      return pieces.join("") + "\n";
    }
    return pieces.join(" ");
  }
  return "";
}

export function hasRequiredLabel(labels: string[], target: string = REQUIRED_WORKFLOW_LABEL): boolean {
  const norm = target.toLowerCase();
  return labels.some((l) => l.toLowerCase() === norm);
}

async function detectGitHubRepo(cwd: string): Promise<string | null> {
  const res = await execCommand("git", ["remote", "get-url", "origin"], { cwd });
  if (res.exitCode !== 0) return null;
  const url = res.stdout.trim();
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function toGitHubTicket(item: {
  number: number;
  title: string;
  body?: string;
  labels?: Array<{ name: string } | string>;
  url?: string;
  html_url?: string;
}): TrackerTicket {
  const labels = (item.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  return {
    id: `GH-${item.number}`,
    title: item.title,
    description: item.body || "",
    acceptanceCriteria: extractCriteria(item.body || ""),
    labels,
    url: item.html_url || item.url || "",
    provider: "github" as const,
  };
}

/**
 * Fetch GitHub issues with label filter.
 */
export async function fetchGitHubTickets(options: {
  repo?: string;
  token?: string;
  cwd?: string;
  requiredLabel?: string;
}): Promise<TrackerTicket[]> {
  const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;

  if (options.token && options.repo) {
    const url = `https://api.github.com/repos/${options.repo}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "x-factory",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as Array<{
      number: number;
      title: string;
      body?: string;
      labels: Array<{ name: string } | string>;
      html_url: string;
      pull_request?: unknown;
    }>;

    return data
      .filter((item) => !item.pull_request)
      .map(toGitHubTicket)
      .filter((t) => hasRequiredLabel(t.labels, label));
  }

  // Fallback: gh CLI
  const args = [
    "issue",
    "list",
    "--label",
    label,
    "--state",
    "open",
    "--json",
    "number,title,body,labels,url",
  ];
  if (options.repo) {
    args.push("--repo", options.repo);
  }

  const result = await execCommand("gh", args, { cwd: options.cwd });
  if (result.exitCode !== 0) {
    return [];
  }

  try {
    const items = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      body?: string;
      labels: Array<{ name: string } | string>;
      url: string;
    }>;

    return items
      .map(toGitHubTicket)
      .filter((t) => hasRequiredLabel(t.labels, label));
  } catch {
    return [];
  }
}


/**
 * Fetch Jira tickets via REST API v3 with JQL.
 */
export async function fetchJiraTickets(options: {
  host: string;
  email: string;
  token: string;
  project?: string;
  requiredLabel?: string;
}): Promise<TrackerTicket[]> {
  const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
  const cleanHost = options.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const jql = `labels = "${label}"${options.project ? ` AND project = "${options.project}"` : ""} AND statusCategory != Done ORDER BY updated DESC`;
  const url = `https://${cleanHost}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50`;

  const auth = Buffer.from(`${options.email}:${options.token}`).toString("base64");
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    issues: Array<{
      key: string;
      fields: {
        summary: string;
        description?: unknown;
        labels?: string[];
      };
    }>;
  };

  return (data.issues || []).map((issue) => {
    let desc = "";
    if (typeof issue.fields.description === "string") {
      desc = issue.fields.description;
    } else if (issue.fields.description) {
      desc = parseAdfToText(issue.fields.description);
    }

    const labels = issue.fields.labels || [];
    return {
      id: issue.key,
      title: issue.fields.summary,
      description: desc,
      acceptanceCriteria: extractCriteria(desc),
      labels,
      url: `https://${cleanHost}/browse/${issue.key}`,
      provider: "jira" as const,
    };
  });
}

/**
 * Fetch Azure DevOps work items via WIQL.
 */
export async function fetchAzureTickets(options: {
  orgUrl: string;
  project: string;
  pat: string;
  requiredLabel?: string;
}): Promise<TrackerTicket[]> {
  const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
  const base = options.orgUrl.replace(/\/+$/, "");
  const wiqlUrl = `${base}/${encodeURIComponent(options.project)}/_apis/wit/wiql?api-version=7.1`;
  const auth = Buffer.from(`:${options.pat}`).toString("base64");

  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${options.project}' AND [System.Tags] CONTAINS '${label}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(wiqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!wiqlRes.ok) {
    throw new Error(`Azure DevOps WIQL error ${wiqlRes.status}: ${await wiqlRes.text()}`);
  }

  const wiqlData = (await wiqlRes.json()) as { workItems?: Array<{ id: number }> };
  const ids = (wiqlData.workItems || []).map((w) => w.id).slice(0, 50);

  if (ids.length === 0) return [];

  const itemsUrl = `${base}/${encodeURIComponent(options.project)}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.1`;
  const itemsRes = await fetch(itemsUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!itemsRes.ok) {
    throw new Error(`Azure DevOps WorkItems error ${itemsRes.status}: ${await itemsRes.text()}`);
  }

  const itemsData = (await itemsRes.json()) as {
    value: Array<{
      id: number;
      fields: Record<string, unknown>;
      _links?: { html?: { href?: string } };
    }>;
  };

  return itemsData.value.map((item) => {
    const title = String(item.fields["System.Title"] || "");
    const rawDesc = String(item.fields["System.Description"] || "");
    const rawCriteria = String(item.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "");
    const desc = stripHtml(rawDesc);
    const criteriaText = rawCriteria ? stripHtml(rawCriteria) : desc;
    const tags = String(item.fields["System.Tags"] || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      id: `AZ-${item.id}`,
      title,
      description: desc,
      acceptanceCriteria: extractCriteria(criteriaText),
      labels: tags,
      url: item._links?.html?.href || "",
      provider: "azure" as const,
    };
  });
}

function getJiraConfig(options: TrackerOptions, saved?: FactorySettings["jira"]) {
  const cfg = saved || {};
  return {
    host: options.jiraHost || cfg.host,
    email: options.jiraEmail || cfg.email,
    token: options.jiraToken || cfg.token,
    project: options.jiraProject || cfg.project,
  };
}

function tryFetchJira(
  provider: string,
  options: TrackerOptions,
  settings: Awaited<ReturnType<typeof loadSettings>>
): Promise<TrackerTicket[]> | null {
  if (provider !== "jira") return null;
  const { host, email, token, project } = getJiraConfig(options, settings.jira);
  if (!host || !email || !token) return null;

  return fetchJiraTickets({
    host,
    email,
    token,
    project,
    requiredLabel: options.requiredLabel,
  });
}

function getAzureConfig(options: TrackerOptions, saved?: FactorySettings["azure"]) {
  const cfg = saved || {};
  return {
    orgUrl: options.azureOrgUrl || cfg.orgUrl,
    project: options.azureProject || cfg.project,
    pat: options.azurePat || cfg.pat,
  };
}

function tryFetchAzure(
  provider: string,
  options: TrackerOptions,
  settings: Awaited<ReturnType<typeof loadSettings>>
): Promise<TrackerTicket[]> | null {
  if (provider !== "azure") return null;
  const { orgUrl, project, pat } = getAzureConfig(options, settings.azure);
  if (!orgUrl || !project || !pat) return null;

  return fetchAzureTickets({
    orgUrl,
    project,
    pat,
    requiredLabel: options.requiredLabel,
  });
}

async function fetchDefaultGitHub(
  repoPath: string,
  options: TrackerOptions,
  settings: Awaited<ReturnType<typeof loadSettings>>
): Promise<TrackerTicket[]> {
  const token = options.githubToken || settings.github?.token;
  const repo =
    options.githubRepo ||
    settings.github?.repo ||
    (await detectGitHubRepo(repoPath)) ||
    undefined;

  return fetchGitHubTickets({
    repo,
    token,
    cwd: repoPath,
    requiredLabel: options.requiredLabel,
  });
}

/**
 * Unified resolver for project tickets.
 */
export async function fetchProjectTickets(
  projectId: string,
  options: TrackerOptions = {}
): Promise<TrackerTicket[]> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" not found.`);
  }

  const settings = await loadSettings(false);
  const provider = options.provider || settings.activeTracker || "github";

  const jira = tryFetchJira(provider, options, settings);
  if (jira) return jira;

  const azure = tryFetchAzure(provider, options, settings);
  if (azure) return azure;

  return fetchDefaultGitHub(project.repositoryPath, options, settings);
}


