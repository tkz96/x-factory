// src/providers/github/tickets.ts — GitHub ticket listing, filtering, and criteria extraction (#138).

import type {
  ProviderConfig,
  TicketQueryOptions,
  TrackerTicket,
} from "../contract.js";
import { type HttpTransport, parseLinkNextUrl } from "../http.js";
import {
  DEFAULT_PAGE_CAP,
  extractAcceptanceCriteria,
} from "../ticket-normalization.js";
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

function normalizeLabels(rawLabels?: Array<string | RawGitHubLabel>): string[] {
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels
    .map((lbl) => (typeof lbl === "string" ? lbl : lbl.name || ""))
    .filter(Boolean);
}

/**
 * Converts a raw GitHub issue into a normalized TrackerTicket, or null when the
 * issue is a pull request or does not carry the required label.
 */
function toTrackerTicket(
  issue: RawGitHubIssue,
  requiredLabel: string | undefined,
  issueBaseUrl: string,
): TrackerTicket | null {
  if (issue.pull_request) return null;

  const labels = normalizeLabels(issue.labels);
  if (requiredLabel && !labels.includes(requiredLabel)) {
    return null;
  }

  const acceptanceCriteria = extractAcceptanceCriteria(issue.body);
  return {
    id: `GH-${issue.number}`,
    title: issue.title,
    description: issue.body || "",
    acceptanceCriteria,
    labels,
    url: issue.html_url || `${issueBaseUrl}/${issue.number}`,
    provider: "github",
    ...(issue.updated_at ? { updatedAt: issue.updated_at } : {}),
  };
}

/**
 * Lists tickets (issues) from a GitHub repository, filtering out pull requests.
 *
 * Follows `Link: rel="next"` pages up to the page cap; a visited-URL set breaks
 * repeated-link loops.
 */
export async function listGitHubTickets(
  config: ProviderConfig,
  options: TicketQueryOptions,
  fetchFn?: typeof fetch | HttpTransport | undefined,
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
  const issueBaseUrl = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;

  let nextUrl: string | undefined = `${issueBaseUrl}?state=open&per_page=100`;
  if (options.requiredLabel) {
    nextUrl += `&labels=${encodeURIComponent(options.requiredLabel)}`;
  }

  const headers = resolveGitHubHeaders(token);
  const visited = new Set<string>();
  const tickets: TrackerTicket[] = [];

  const pageCap = options.pageCap ?? DEFAULT_PAGE_CAP;
  let pagesFetched = 0;

  while (nextUrl && !visited.has(nextUrl) && pagesFetched < pageCap) {
    pagesFetched++;
    visited.add(nextUrl);

    const res = await githubFetch(nextUrl, { headers, fetchFn });
    const rawIssues = (
      Array.isArray(res.data) ? res.data : []
    ) as RawGitHubIssue[];

    // GitHub returns pull requests in the issues endpoint;
    // toTrackerTicket excludes them from the normalized output.
    for (const issue of rawIssues) {
      const ticket = toTrackerTicket(
        issue,
        options.requiredLabel,
        issueBaseUrl,
      );
      if (ticket) tickets.push(ticket);
    }

    nextUrl = parseLinkNextUrl(res.headers.get("link")) ?? undefined;
  }

  return tickets;
}
