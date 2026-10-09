// src/shared/legacy-aliases.ts — The ONE list of historical config aliases (#186).
//
// Pure and import-free, so the provider migration step (server) and the shared
// duplicate-identity reader (also bundled for the browser) consume the same
// table. A new historical alias is added here and nowhere else.

/** Nested provider views a historical record may carry its config under. */
export const NESTED_VIEW_KEYS = [
  "github",
  "gitHost",
  "tracker",
  "azure",
] as const;

/** GitHub: owner / organization keys, canonical first. */
export const GITHUB_OWNER_KEYS = [
  "repoOwner",
  "owner",
  "organization",
  "org",
] as const;

/** GitHub: token keys, canonical first. */
export const GITHUB_TOKEN_KEYS = ["token", "githubToken"] as const;

/** GitHub: repository keys, canonical first. */
export const GITHUB_REPO_KEYS = ["repository", "repo"] as const;

/** Azure: organization keys that map to `orgUrl`. */
export const AZURE_ORG_KEYS = ["organization", "org"] as const;

/** Root keys the migration step consumes (aliases, URL hints, containers). */
export const CONSUMED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "providerId",
  "connectionId",
  "owner",
  "org",
  "organization",
  "repo",
  "githubToken",
  "token",
  "pat",
  "apiToken",
  "jiraHost",
  "jiraEmail",
  "jiraToken",
  "projectId",
  "url",
  "webUrl",
  "remoteUrl",
  "config",
  "connections",
  "tracker",
  "gitHost",
  "github",
  "azure",
  "jira",
]);
