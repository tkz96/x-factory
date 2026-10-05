// src/providers/discriminator.ts — Shared cross-provider discrimination knowledge.
//
// Encapsulates heuristics to determine whether a nested or flat configuration
// object belongs to a provider other than the caller, preventing cross-provider
// leakage without hardcoding foreign schemas inside individual provider modules.

import type { ProviderId } from "./contract.js";

/** Signature patterns characterizing exclusive provider domains or field names. */
const PROVIDER_EXCLUSIVE_SIGNATURES: Record<
  ProviderId,
  (obj: Record<string, unknown>) => boolean
> = {
  jira: (obj) => {
    if (
      typeof obj.host === "string" &&
      obj.host.toLowerCase().includes("atlassian.net")
    ) {
      return true;
    }
    return Boolean(obj.jiraHost || obj.jiraToken || obj.jiraEmail);
  },
  azure: (obj) => {
    if (typeof obj.orgUrl === "string" || typeof obj.pat === "string") {
      return true;
    }
    return Boolean(obj.azureOrgUrl || obj.azureProject || obj.azurePat);
  },
  github: (obj) => {
    if (typeof obj.repo === "string" && !obj.host && !obj.orgUrl && !obj.pat) {
      return true;
    }
    return Boolean(obj.githubRepo || obj.githubToken);
  },
};

/**
 * Checks whether an object belongs to another provider based on explicit provider
 * identity or known exclusive provider signatures.
 */
export function isForeignProviderObject(
  obj: Record<string, unknown>,
  targetProviderId: ProviderId,
): boolean {
  if (!obj || typeof obj !== "object") return false;

  // 1. Explicit provider identity tags
  if (
    typeof obj.providerId === "string" &&
    obj.providerId !== targetProviderId
  ) {
    return true;
  }
  if (typeof obj.provider === "string" && obj.provider !== targetProviderId) {
    return true;
  }

  // 2. Check signatures of any provider other than targetProviderId
  for (const [id, matchesSignature] of Object.entries(
    PROVIDER_EXCLUSIVE_SIGNATURES,
  )) {
    if (id !== targetProviderId && matchesSignature(obj)) {
      return true;
    }
  }

  return false;
}
