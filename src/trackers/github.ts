// src/trackers/github.ts — GitHub Issues tracker integration (REST API + gh CLI).

import { execCommand } from "../proc.js";
import { extractCriteria } from "./parser.js";
import {
  hasRequiredLabel,
  REQUIRED_WORKFLOW_LABEL,
  type TrackerTicket,
} from "./types.js";

export async function detectGitHubRepo(cwd: string): Promise<string | null> {
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
