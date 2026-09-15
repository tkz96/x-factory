// src/discovery/index.ts — Pluggable discovery provider registry.

import { AzureDevOpsRepositoryDiscovery } from "./azure.js";
import { GitHubRepositoryDiscovery } from "./github.js";
import { JiraRepositoryDiscovery } from "./jira.js";
import { LocalWorkspaceRepositoryDiscovery } from "./local.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

export {
  AzureDevOpsRepositoryDiscovery,
  extractAzureDevOpsInfo,
} from "./azure.js";
export { GitHubRepositoryDiscovery } from "./github.js";
export { JiraRepositoryDiscovery } from "./jira.js";
export { LocalWorkspaceRepositoryDiscovery } from "./local.js";
export * from "./types.js";

const PROVIDERS: Record<string, RepositoryDiscoveryProvider> = {
  azure: new AzureDevOpsRepositoryDiscovery(),
  "azure-devops": new AzureDevOpsRepositoryDiscovery(),
  github: new GitHubRepositoryDiscovery(),
  jira: new JiraRepositoryDiscovery(),
  local: new LocalWorkspaceRepositoryDiscovery(),
};

/**
 * Resolve a repository discovery provider by identifier.
 */
export function getDiscoveryProvider(
  providerName: string,
): RepositoryDiscoveryProvider {
  const normalized = providerName.toLowerCase().trim();
  const provider = PROVIDERS[normalized];
  if (!provider) {
    throw new Error(
      `Unsupported discovery provider "${providerName}". Supported providers: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

/**
 * Execute repository discovery against the chosen provider.
 */
export async function discoverRepositories(
  input: RepositoryDiscoveryInput,
): Promise<DiscoveredRepository[]> {
  const provider = getDiscoveryProvider(input.provider);
  return provider.listRepositories(input);
}
