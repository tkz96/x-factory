// src/trackers/azure.ts — Azure DevOps work items integration with WIQL.

import { resolveAzureAuthHeader } from "../azure/auth.js";
import { extractCriteria, stripHtml } from "./parser.js";
import {
  AzureWiqlResponseSchema,
  type AzureWorkItem,
  AzureWorkItemBatchSchema,
} from "./schemas.js";
import { REQUIRED_WORKFLOW_LABEL, type TrackerTicket } from "./types.js";

async function queryAzureWorkItemIds(
  orgUrl: string,
  project: string,
  auth: string,
  label: string,
): Promise<number[]> {
  const wiqlUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`;
  const escapedLabel = label.replace(/'/g, "''");
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS '${escapedLabel}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC`;

  const res = await fetch(wiqlUrl, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(
      `Azure DevOps WIQL error ${res.status}: ${await res.text()}`,
    );
  }
  const raw = await res.json();
  const parsed = AzureWiqlResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Azure DevOps WIQL response validation failed: ${parsed.error.message}`,
    );
  }
  return (parsed.data.workItems ?? []).map((w) => w.id).slice(0, 50);
}

function parseAzureWorkItem(item: AzureWorkItem): TrackerTicket {
  const title = String(item.fields["System.Title"] || "");
  const rawDesc = String(item.fields["System.Description"] || "");
  const rawCriteria = String(
    item.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
  );
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
}

/**
 * Fetch Azure DevOps work items via WIQL.
 */
export async function fetchAzureTickets(options: {
  orgUrl: string;
  project: string;
  pat?: string | undefined;
  requiredLabel?: string | undefined;
}): Promise<TrackerTicket[]> {
  const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
  const authHeader = await resolveAzureAuthHeader(options.pat);
  if (!authHeader) {
    throw new Error(
      "Azure DevOps authentication required. Configure a PAT or log in with Azure CLI ('az login').",
    );
  }
  const ids = await queryAzureWorkItemIds(
    options.orgUrl,
    options.project,
    authHeader,
    label,
  );
  if (ids.length === 0) return [];

  const base = options.orgUrl.replace(/\/+$/, "");
  const itemsUrl = `${base}/${encodeURIComponent(options.project)}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.1`;
  const itemsRes = await fetch(itemsUrl, {
    headers: { Authorization: authHeader },
  });

  if (!itemsRes.ok) {
    throw new Error(
      `Azure DevOps WorkItems error ${itemsRes.status}: ${await itemsRes.text()}`,
    );
  }

  const itemsRaw = await itemsRes.json();
  const itemsParsed = AzureWorkItemBatchSchema.safeParse(itemsRaw);
  if (!itemsParsed.success) {
    throw new Error(
      `Azure DevOps WorkItems response validation failed: ${itemsParsed.error.message}`,
    );
  }

  return itemsParsed.data.value.map(parseAzureWorkItem);
}
