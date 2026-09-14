// src/trackers/azure.ts — Azure DevOps work items integration with WIQL.

import type { FactorySettings } from "../settings.js";
import { extractCriteria, stripHtml } from "./parser.js";
import {
  REQUIRED_WORKFLOW_LABEL,
  type TrackerOptions,
  type TrackerTicket,
} from "./types.js";

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

function getAzureConfig(options: TrackerOptions, saved?: FactorySettings["azure"]) {
  const cfg = saved || {};
  return {
    orgUrl: options.azureOrgUrl || cfg.orgUrl,
    project: options.azureProject || cfg.project,
    pat: options.azurePat || cfg.pat,
  };
}

export function tryFetchAzure(
  provider: string,
  options: TrackerOptions,
  savedAzure?: FactorySettings["azure"]
): Promise<TrackerTicket[]> | null {
  if (provider !== "azure") return null;
  const { orgUrl, project, pat } = getAzureConfig(options, savedAzure);
  if (!orgUrl || !project || !pat) return null;

  return fetchAzureTickets({
    orgUrl,
    project,
    pat,
    requiredLabel: options.requiredLabel,
  });
}
