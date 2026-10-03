// src/trackers/types.ts — Legacy tracker types.
//
// The canonical provider contract now lives in src/providers/contract.ts
// (wayfinder #127). This module re-exports the shared shapes so existing
// consumers keep working until the absorb-and-delete migration removes it.

import type { ProviderId } from "../providers/contract.js";
import { REQUIRED_WORKFLOW_LABEL } from "../providers/contract.js";

export type { TrackerTicket } from "../providers/contract.js";
export { REQUIRED_WORKFLOW_LABEL };

export type TrackerProvider = ProviderId;

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
