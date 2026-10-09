// src/providers/github/config.ts — GitHub configuration schema, resolution, and mismatch detection (#138, #186).

import { z } from "zod/v4";
import { toTypedProviderConfig } from "../config-validation.js";
import { identityField, joinIdentityParts } from "../connection-identity.js";
import type { ProviderConfig } from "../contract.js";

/**
 * Presentation metadata keys for Zod schema fields.
 */
export const githubConfigSchema = z.object({
  token: z.string().trim().min(1, "Personal Access Token is required").meta({
    label: "Personal Access Token",
    uiType: "secret",
    secret: true,
    envKey: "GITHUB_TOKEN",
    placeholder: "ghp_...",
    help: "Personal Access Token with required scopes: 'repo' (code, pull requests) and 'workflow' (GitHub Actions).",
  }),
  repoOwner: z
    .string()
    .trim()
    .min(1, "Repository owner or organization is required")
    .optional()
    .meta({
      label: "Owner / Organization",
      uiType: "text",
      placeholder: "octocat",
      help: "GitHub username or organization name that owns the repository.",
    }),
  repository: z
    .string()
    .trim()
    .min(1, "Repository name is required")
    .optional()
    .meta({
      label: "Repository",
      uiType: "text",
      placeholder: "hello-world",
      help: "Target repository name. Leave empty to discover repositories across the organization.",
      roles: ["tracker"],
    }),
  baseUrl: z.string().url().optional().meta({
    label: "Base URL",
    uiType: "url",
    placeholder: "https://api.github.com",
    help: "GitHub Enterprise API base URL (optional, defaults to https://api.github.com).",
  }),
});

export interface ResolvedGitHubConfig {
  token?: string | undefined;
  owner?: string | undefined;
  repo?: string | undefined;
  baseUrl?: string | undefined;
}

/**
 * Detects whether configuration input contains conflicting GitHub values.
 * Delegates to the shared typed-config entry point (#186).
 */
export function detectGitHubConfigMismatch(config: ProviderConfig): {
  mismatch: boolean;
  error?: string;
} {
  const typed = toTypedProviderConfig(
    { id: "github", configSchema: githubConfigSchema },
    config,
  );
  if (!typed.ok && typed.conflict !== undefined) {
    return { mismatch: true, error: typed.conflict };
  }
  return { mismatch: false };
}

/**
 * The connection's identity as a human reads it (#133 story 34): `"owner/repo"`.
 * `repoOwner` and `repository` are the provider's two identity fields, and
 * whichever one is recorded is used on its own when the other is missing.
 *
 * The token is NEVER read: an identity is presentation metadata that may be
 * rendered on any surface, while the token is a credential that never leaves
 * the request that carried it.
 */
export function describeGitHubConnection(
  config: ProviderConfig,
): string | null {
  return joinIdentityParts(
    [identityField(config.repoOwner), identityField(config.repository)],
    "/",
  );
}

/**
 * Resolves token, owner, repository, and baseUrl directly from typed provider config (#186).
 * Adapters do not search for aliased or nested keys; callers validate with the schema once.
 */
export function resolveGitHubConfig(
  config: ProviderConfig,
): ResolvedGitHubConfig {
  if (!config || typeof config !== "object") {
    return {};
  }

  const token =
    typeof config.token === "string" && config.token.trim()
      ? config.token.trim()
      : undefined;
  const owner =
    typeof config.repoOwner === "string" && config.repoOwner.trim()
      ? config.repoOwner.trim()
      : undefined;
  const repo =
    typeof config.repository === "string" && config.repository.trim()
      ? config.repository.trim()
      : undefined;
  const baseUrl =
    typeof config.baseUrl === "string" && config.baseUrl.trim()
      ? config.baseUrl.trim()
      : undefined;

  return {
    ...(token ? { token } : {}),
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}
