// src/discovery/types.ts — Interfaces for platform-agnostic repository discovery.

export interface DiscoveredRepository {
  id: string;
  name: string;
  remote: string;
  defaultBranch?: string;
  webUrl?: string;
}

export interface RepositoryDiscoveryInput {
  provider: "azure" | "azure-devops" | "github" | "jira" | "local" | string;
  orgUrl?: string;
  project?: string;
  pat?: string;
  token?: string;
  repoOwner?: string;
  workspacePath?: string;
  jiraHost?: string;
  jiraEmail?: string;
  jiraToken?: string;
  primaryRepo?: string;
}

export interface RepositoryDiscoveryProvider {
  readonly provider: string;
  listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]>;
}
