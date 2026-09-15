// src/discovery/types.ts — Interfaces for platform-agnostic repository discovery.

export interface DiscoveredRepository {
  id: string;
  name: string;
  remote: string;
  defaultBranch?: string | undefined;
  webUrl?: string | undefined;
}

export interface RepositoryDiscoveryInput {
  provider: "azure" | "azure-devops" | "github" | "jira" | "local" | string;
  orgUrl?: string | undefined;
  project?: string | undefined;
  pat?: string | undefined;
  token?: string | undefined;
  repoOwner?: string | undefined;
  workspacePath?: string | undefined;
  jiraHost?: string | undefined;
  jiraEmail?: string | undefined;
  jiraToken?: string | undefined;
  primaryRepo?: string | undefined;
}

export interface RepositoryDiscoveryProvider {
  readonly provider: string;
  listRepositories(
    input: RepositoryDiscoveryInput,
  ): Promise<DiscoveredRepository[]>;
}
