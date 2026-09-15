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

export function hasRequiredLabel(
  labels: string[],
  target: string = REQUIRED_WORKFLOW_LABEL,
): boolean {
  const norm = target.toLowerCase();
  return labels.some((l) => l.toLowerCase() === norm);
}
