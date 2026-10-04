// src/providers/github/config.ts — GitHub configuration schema, resolution, and mismatch detection (#138).

import { z } from "zod/v4";
import type { ProviderConfig } from "../contract.js";
import { extractFromGitHubUrl } from "./urls.js";

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
    help: "Personal Access Token (classic or fine-grained) with repo and project permissions.",
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
});

export interface ResolvedGitHubConfig {
  token?: string | undefined;
  owner?: string | undefined;
  repo?: string | undefined;
  baseUrl?: string | undefined;
}

interface CandidateValue {
  source: string;
  value: string;
}

interface ExtractionTargets {
  candidateOrgs: CandidateValue[];
  candidateTokens: CandidateValue[];
  candidateRepos: CandidateValue[];
  candidateBaseUrls: CandidateValue[];
}

/**
 * Checks whether an object belongs to another provider based on provider identity or provider-exclusive fields.
 */
function isNonGitHubObject(obj: Record<string, unknown>): boolean {
  if (typeof obj.providerId === "string" && obj.providerId !== "github") {
    return true;
  }
  if (typeof obj.provider === "string" && obj.provider !== "github") {
    return true;
  }
  // Jira exclusive fields
  if (
    typeof obj.host === "string" &&
    obj.host.toLowerCase().includes("atlassian.net")
  ) {
    return true;
  }
  // Azure DevOps exclusive fields
  if (typeof obj.orgUrl === "string" || typeof obj.pat === "string") {
    return true;
  }
  return false;
}

/**
 * Extracts candidate values strictly for GitHub-owned schema fields.
 */
function extractMatchingKeys(
  rec: Record<string, unknown>,
  keys: string[],
  prefix: string,
  targetList: CandidateValue[],
): void {
  for (const key of keys) {
    if (typeof rec[key] === "string") {
      const val = (rec[key] as string).trim();
      if (val) {
        targetList.push({
          source: `${prefix}${key}`,
          value: val,
        });
      }
    }
  }
}

function extractGitHubCandidatesFromObject(
  prefix: string,
  obj: unknown,
  targets: ExtractionTargets,
): void {
  if (!obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;

  if (isNonGitHubObject(rec)) {
    return;
  }

  // 1. GitHub Organization / Owner candidates
  extractMatchingKeys(
    rec,
    ["repoOwner", "owner", "organization", "org"],
    prefix,
    targets.candidateOrgs,
  );

  // 2. GitHub Token candidates (only token and githubToken; NOT apiToken or pat)
  extractMatchingKeys(
    rec,
    ["token", "githubToken"],
    prefix,
    targets.candidateTokens,
  );

  // 3. GitHub Repository candidates (repository or repo; NOT project)
  extractMatchingKeys(
    rec,
    ["repository", "repo"],
    prefix,
    targets.candidateRepos,
  );

  // 4. Base URL candidate
  extractMatchingKeys(rec, ["baseUrl"], prefix, targets.candidateBaseUrls);

  // 5. GitHub URL candidates
  const urlVal = rec.url ?? rec.webUrl ?? rec.remoteUrl;
  if (typeof urlVal === "string" && urlVal.trim()) {
    const extracted = extractFromGitHubUrl(urlVal);
    if (extracted?.owner) {
      targets.candidateOrgs.push({
        source: `${prefix}url(owner)`,
        value: extracted.owner,
      });
    }
    if (extracted?.repo) {
      targets.candidateRepos.push({
        source: `${prefix}url(repo)`,
        value: extracted.repo,
      });
    }
  }
}

function inspectConnections(
  connections: unknown,
  targets: ExtractionTargets,
): void {
  if (!Array.isArray(connections)) return;
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    if (conn && typeof conn === "object") {
      const c = conn as Record<string, unknown>;
      // Only inspect if providerId explicitly matches github or is untagged github
      if (c.providerId === "github") {
        extractGitHubCandidatesFromObject(
          `connections[${i}].config.`,
          c.config,
          targets,
        );
        extractGitHubCandidatesFromObject(`connections[${i}].`, c, targets);
      }
    }
  }
}

function checkDisagreements(
  candidates: CandidateValue[],
  caseInsensitive: boolean,
  kind: string,
): { mismatch: boolean; error?: string } {
  if (candidates.length <= 1) {
    return { mismatch: false };
  }
  const first = candidates[0];
  if (!first) return { mismatch: false };

  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i];
    if (!next) continue;
    const matches = caseInsensitive
      ? first.value.toLowerCase() === next.value.toLowerCase()
      : first.value === next.value;

    if (!matches) {
      if (kind === "token") {
        return {
          mismatch: true,
          error: `Configuration mismatch: conflicting token values detected across configuration fields ("${first.source}" vs "${next.source}"). Distinct configurations must not be silently collapsed.`,
        };
      }
      return {
        mismatch: true,
        error: `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct ${kind} configurations and cannot be conflated.`,
      };
    }
  }
  return { mismatch: false };
}

/**
 * Gathers all GitHub candidate values from flat and wizard-shaped configurations.
 */
function gatherGitHubCandidates(config: ProviderConfig): ExtractionTargets {
  const targets: ExtractionTargets = {
    candidateOrgs: [],
    candidateTokens: [],
    candidateRepos: [],
    candidateBaseUrls: [],
  };

  if (!config || typeof config !== "object") {
    return targets;
  }

  // 1. Root configuration fields
  extractGitHubCandidatesFromObject("", config, targets);

  // 2. Explicit provider-namespaced containers
  if (config.github && typeof config.github === "object") {
    extractGitHubCandidatesFromObject("github.", config.github, targets);
  }

  // 3. Role-based containers (only if they belong to GitHub)
  if (config.gitHost && typeof config.gitHost === "object") {
    extractGitHubCandidatesFromObject("gitHost.", config.gitHost, targets);
  }

  if (config.tracker && typeof config.tracker === "object") {
    extractGitHubCandidatesFromObject("tracker.", config.tracker, targets);
  }

  // 4. Nested config block (e.g. /verify envelope)
  if (config.config && typeof config.config === "object") {
    extractGitHubCandidatesFromObject("config.", config.config, targets);
  }

  // 5. Connections array (#131 normalized project payload)
  inspectConnections(config.connections, targets);

  return targets;
}

function normalizeBaseUrl(val: string): string {
  const trimmed = val.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function checkBaseUrlDisagreements(candidates: CandidateValue[]): {
  mismatch: boolean;
  error?: string;
} {
  if (candidates.length <= 1) {
    return { mismatch: false };
  }
  const first = candidates[0];
  if (!first) return { mismatch: false };
  const firstNormalized = normalizeBaseUrl(first.value);

  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i];
    if (!next) continue;
    const nextNormalized = normalizeBaseUrl(next.value);
    if (firstNormalized !== nextNormalized) {
      return {
        mismatch: true,
        error: `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct baseUrl configurations and cannot be conflated.`,
      };
    }
  }
  return { mismatch: false };
}

/**
 * Detects whether configuration input contains conflicting GitHub values.
 * Ignores configurations that belong to other providers (Jira, Azure, etc.).
 */
export function detectGitHubConfigMismatch(config: ProviderConfig): {
  mismatch: boolean;
  error?: string;
} {
  const { candidateOrgs, candidateTokens, candidateRepos, candidateBaseUrls } =
    gatherGitHubCandidates(config);

  const orgCheck = checkDisagreements(candidateOrgs, true, "organization");
  if (orgCheck.mismatch) return orgCheck;

  const tokenCheck = checkDisagreements(candidateTokens, false, "token");
  if (tokenCheck.mismatch) return tokenCheck;

  const repoCheck = checkDisagreements(candidateRepos, true, "repository");
  if (repoCheck.mismatch) return repoCheck;

  const baseUrlCheck = checkBaseUrlDisagreements(candidateBaseUrls);
  if (baseUrlCheck.mismatch) return baseUrlCheck;

  return { mismatch: false };
}

/**
 * Resolves token, owner, repository, and baseUrl from flat or nested provider configuration.
 * Validates against ambiguous or conflicting inputs.
 */
export function resolveGitHubConfig(
  config: ProviderConfig,
): ResolvedGitHubConfig {
  const mismatch = detectGitHubConfigMismatch(config);
  if (mismatch.mismatch) {
    throw new Error(mismatch.error);
  }

  const { candidateOrgs, candidateTokens, candidateRepos, candidateBaseUrls } =
    gatherGitHubCandidates(config);

  const owner = candidateOrgs[0]?.value;
  const token = candidateTokens[0]?.value;
  const repo = candidateRepos[0]?.value;
  const baseUrl = candidateBaseUrls[0]?.value;

  return {
    ...(token ? { token } : {}),
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}
