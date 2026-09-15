// src/trackers/jira.ts — Jira Software REST API v3 integration with JQL.

import type { FactorySettings } from "../settings.js";
import { parseAdfToText } from "./jira-adf.js";
import { extractCriteria } from "./parser.js";
import { JiraSearchResponseSchema } from "./schemas.js";
import {
  REQUIRED_WORKFLOW_LABEL,
  type TrackerOptions,
  type TrackerTicket,
} from "./types.js";

/**
 * Fetch Jira tickets via REST API v3 with JQL.
 */
export async function fetchJiraTickets(options: {
  host: string;
  email: string;
  token: string;
  project?: string | undefined;
  requiredLabel?: string | undefined;
}): Promise<TrackerTicket[]> {
  const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
  const cleanHost = options.host
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const jql = `labels = "${label}"${options.project ? ` AND project = "${options.project}"` : ""} AND statusCategory != Done ORDER BY updated DESC`;
  const url = `https://${cleanHost}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50`;

  const auth = Buffer.from(`${options.email}:${options.token}`).toString(
    "base64",
  );
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
  }

  const raw = await res.json();
  const parsed = JiraSearchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Jira search API response validation failed: ${parsed.error.message}`,
    );
  }

  return (parsed.data.issues ?? []).map((issue) => {
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

function getJiraConfig(
  options: TrackerOptions,
  saved?: FactorySettings["jira"],
) {
  const cfg = saved || {};
  return {
    host: options.jiraHost || cfg.host,
    email: options.jiraEmail || cfg.email,
    token: options.jiraToken || cfg.token,
    project: options.jiraProject || cfg.project,
  };
}

export function tryFetchJira(
  provider: string,
  options: TrackerOptions,
  savedJira?: FactorySettings["jira"],
): Promise<TrackerTicket[]> | null {
  if (provider !== "jira") return null;
  const { host, email, token, project } = getJiraConfig(options, savedJira);
  if (!host || !email || !token) return null;

  return fetchJiraTickets({
    host,
    email,
    token,
    project,
    requiredLabel: options.requiredLabel,
  });
}
