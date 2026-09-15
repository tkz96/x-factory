// src/trackers/types.ts — Interfaces and constants for issue tracker integrations.

import type { Ticket } from "../types.js";

export const REQUIRED_WORKFLOW_LABEL = "agentic-workflow";

export type TrackerProvider = "github" | "jira" | "azure";

export interface TrackerTicket extends Ticket {
  labels: string[];
  url: string;
  provider: TrackerProvider;
  updatedAt?: string;
}

export interface TrackerOptions {
  provider?: TrackerProvider | undefined;
  requiredLabel?: string | undefined;
  // GitHub
  githubRepo?: string | undefined;
  githubToken?: string | undefined;
  // Jira
  jiraHost?: string | undefined;
  jiraEmail?: string | undefined;
  jiraToken?: string | undefined;
  jiraProject?: string | undefined;
  // Azure DevOps
  azureOrgUrl?: string | undefined;
  azureProject?: string | undefined;
  azurePat?: string | undefined;
}

export function hasRequiredLabel(
  labels: string[],
  target: string = REQUIRED_WORKFLOW_LABEL,
): boolean {
  const norm = target.toLowerCase();
  return labels.some((l) => l.toLowerCase() === norm);
}
