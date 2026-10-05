// src/providers/github/tickets.ts — GitHub ticket listing, filtering, and criteria extraction (#138).

import type {
  ProviderConfig,
  TicketQueryOptions,
  TrackerTicket,
} from "../contract.js";
import { resolveGitHubConfig } from "./config.js";
import {
  DEFAULT_GITHUB_API_ROOT,
  githubFetch,
  resolveGitHubHeaders,
} from "./http.js";
import { resolveRepoCoordinates } from "./urls.js";

interface RawGitHubLabel {
  name?: string;
}

interface RawGitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state?: string;
  html_url?: string;
  updated_at?: string;
  pull_request?: unknown;
  labels?: Array<string | RawGitHubLabel>;
}

function isSectionHeader(line: string): boolean {
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    line,
  );
}

function sanitizeLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function parseBulletLine(line: string): string | null {
  const match = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match?.[1] ? sanitizeLine(match[1]) : null;
}

function extractAcceptanceCriteria(text?: string | null): string[] {
  if (!text || typeof text !== "string") return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const headerIdx = lines.findIndex(isSectionHeader);

  if (headerIdx >= 0) {
    const sectionLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) continue;
      if (/^#+\s+/.test(currentLine)) break;
      const bullet = parseBulletLine(currentLine);
      if (bullet) {
        sectionLines.push(bullet);
      } else if (currentLine.length > 5) {
        sectionLines.push(sanitizeLine(currentLine));
      }
    }
    return sectionLines;
  }

  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

function normalizeLabels(rawLabels?: Array<string | RawGitHubLabel>): string[] {
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels
    .map((lbl) => (typeof lbl === "string" ? lbl : lbl.name || ""))
    .filter(Boolean);
}

/**
 * Lists tickets (issues) from a GitHub repository, filtering out pull requests.
 */
export async function listGitHubTickets(
  config: ProviderConfig,
  options: TicketQueryOptions,
  fetchFn?: typeof fetch,
): Promise<TrackerTicket[]> {
  const {
    token,
    owner: configOwner,
    repo: configRepo,
    baseUrl,
  } = resolveGitHubConfig(config);
  const repoCoordinate =
    typeof config.repository === "string" && config.repository.trim()
      ? config.repository.trim()
      : configRepo;

  // Read-only listing degrades to an empty result while the tracker is not
  // fully configured (missing token, missing repository, or unresolvable
  // owner/repo coordinates) — parity with the legacy tracker path: a project
  // without complete tracker config simply has no tickets to list. Write
  // paths (PR creation/lookup) still fail loudly on incomplete config.
  if (!token) return [];
  if (!repoCoordinate) return [];
  let owner: string | undefined;
  let repo: string | undefined;
  try {
    ({ owner, repo } = resolveRepoCoordinates(repoCoordinate, configOwner));
  } catch {
    return [];
  }
  if (!owner || !repo) return [];
  const root = baseUrl || DEFAULT_GITHUB_API_ROOT;

  let url = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=100`;
  if (options.requiredLabel) {
    url += `&labels=${encodeURIComponent(options.requiredLabel)}`;
  }

  const res = await githubFetch(url, {
    headers: resolveGitHubHeaders(token),
    fetchFn,
  });

  const rawIssues = (
    Array.isArray(res.data) ? res.data : []
  ) as RawGitHubIssue[];

  // GitHub returns pull requests in the issues endpoint; exclude items with `pull_request` key
  const tickets: TrackerTicket[] = [];
  for (const issue of rawIssues) {
    if (issue.pull_request) continue;

    const labels = normalizeLabels(issue.labels);
    if (options.requiredLabel && !labels.includes(options.requiredLabel)) {
      continue;
    }

    const acceptanceCriteria = extractAcceptanceCriteria(issue.body);
    tickets.push({
      id: `GH-${issue.number}`,
      title: issue.title,
      description: issue.body || "",
      acceptanceCriteria,
      labels,
      url: issue.html_url || `${root}/${owner}/${repo}/issues/${issue.number}`,
      provider: "github",
      ...(issue.updated_at ? { updatedAt: issue.updated_at } : {}),
    });
  }

  return tickets;
}
