// src/providers/legacy-migration.ts — Unified legacy provider configuration migration (#186).
//
// Collapses historical aliased keys (owner, repo, githubToken) and nested-container
// searches (azure, tracker, gitHost, connections) into a single migration step.
// Fails closed with descriptive mismatch errors on conflicting inputs.

import { extractOrgNameFromUrl } from "./azure-urls.js";
import type { ProviderConfig } from "./contract.js";
import { isForeignProviderObject } from "./discriminator.js";
import { extractFromGitHubUrl } from "./github/urls.js";

interface CandidateValue {
  readonly source: string;
  readonly value: string;
}

function extractMatchingKeys(
  rec: Record<string, unknown>,
  keys: readonly string[],
  prefix: string,
  targetList: CandidateValue[],
): void {
  for (const key of keys) {
    const val = rec[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed) {
        targetList.push({ source: `${prefix}${key}`, value: trimmed });
      }
    }
  }
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

function checkDisagreements(
  candidates: readonly CandidateValue[],
  caseInsensitive: boolean,
  kind: string,
): void {
  if (candidates.length <= 1) return;
  const first = candidates[0];
  if (!first) return;

  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i];
    if (!next) continue;
    const matches = caseInsensitive
      ? first.value.toLowerCase() === next.value.toLowerCase()
      : first.value === next.value;

    if (!matches) {
      if (kind === "token") {
        throw new Error(
          `Configuration mismatch: conflicting token values detected across configuration fields ("${first.source}" vs "${next.source}"). Distinct configurations must not be silently collapsed.`,
        );
      }
      throw new Error(
        `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct ${kind} configurations and cannot be conflated.`,
      );
    }
  }
}

function checkBaseUrlDisagreements(
  candidates: readonly CandidateValue[],
): void {
  if (candidates.length <= 1) return;
  const first = candidates[0];
  if (!first) return;
  const firstNormalized = normalizeBaseUrl(first.value);

  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i];
    if (!next) continue;
    const nextNormalized = normalizeBaseUrl(next.value);
    if (firstNormalized !== nextNormalized) {
      throw new Error(
        `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct baseUrl configurations and cannot be conflated.`,
      );
    }
  }
}

function extractGitHubRepoKey(
  rec: Record<string, unknown>,
  key: string,
  prefix: string,
  candidateOrgs: CandidateValue[],
  candidateRepos: CandidateValue[],
): void {
  const val = rec[key];
  if (typeof val !== "string") return;
  const trimmed = val.trim();
  if (!trimmed) return;

  if (
    trimmed.includes("/") &&
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://") &&
    !trimmed.includes("@github.com:")
  ) {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] && parts[1]) {
      candidateOrgs.push({ source: `${prefix}${key}(owner)`, value: parts[0] });
      candidateRepos.push({
        source: `${prefix}${key}(repo)`,
        value: parts[1].replace(/\.git$/i, ""),
      });
      return;
    }
  }
  candidateRepos.push({ source: `${prefix}${key}`, value: trimmed });
}

function extractGitHubUrlCandidates(
  rec: Record<string, unknown>,
  prefix: string,
  candidateOrgs: CandidateValue[],
  candidateRepos: CandidateValue[],
): void {
  const urlVal = rec.url ?? rec.webUrl ?? rec.remoteUrl;
  if (typeof urlVal !== "string" || !urlVal.trim()) return;

  const extracted = extractFromGitHubUrl(urlVal.trim());
  if (extracted?.owner) {
    candidateOrgs.push({
      source: `${prefix}url(owner)`,
      value: extracted.owner,
    });
  }
  if (extracted?.repo) {
    candidateRepos.push({
      source: `${prefix}url(repo)`,
      value: extracted.repo,
    });
  }
}

function gatherGitHubCandidates(root: Record<string, unknown>) {
  const candidateOrgs: CandidateValue[] = [];
  const candidateTokens: CandidateValue[] = [];
  const candidateRepos: CandidateValue[] = [];
  const candidateBaseUrls: CandidateValue[] = [];

  const inspectObj = (prefix: string, obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    if (isForeignProviderObject(rec, "github")) return;

    extractMatchingKeys(
      rec,
      ["repoOwner", "owner", "organization", "org"],
      prefix,
      candidateOrgs,
    );
    extractMatchingKeys(rec, ["token", "githubToken"], prefix, candidateTokens);

    extractGitHubRepoKey(
      rec,
      "repository",
      prefix,
      candidateOrgs,
      candidateRepos,
    );
    extractGitHubRepoKey(rec, "repo", prefix, candidateOrgs, candidateRepos);

    extractMatchingKeys(rec, ["baseUrl"], prefix, candidateBaseUrls);
    extractGitHubUrlCandidates(rec, prefix, candidateOrgs, candidateRepos);
  };

  inspectObj("", root);
  inspectObj("github.", root.github);
  inspectObj("gitHost.", root.gitHost);
  inspectObj("tracker.", root.tracker);
  inspectObj("config.", root.config);

  if (Array.isArray(root.connections)) {
    for (let i = 0; i < root.connections.length; i++) {
      const conn = root.connections[i];
      if (conn && typeof conn === "object") {
        const c = conn as Record<string, unknown>;
        if (
          c.providerId === "github" ||
          (!c.providerId && !isForeignProviderObject(c, "github"))
        ) {
          inspectObj(`connections[${i}].config.`, c.config);
          inspectObj(`connections[${i}].`, c);
        }
      }
    }
  }

  return { candidateOrgs, candidateTokens, candidateRepos, candidateBaseUrls };
}

function migrateGitHubConfig(root: Record<string, unknown>): ProviderConfig {
  const { candidateOrgs, candidateTokens, candidateRepos, candidateBaseUrls } =
    gatherGitHubCandidates(root);

  checkDisagreements(candidateOrgs, true, "organization");
  checkDisagreements(candidateTokens, false, "token");
  checkDisagreements(candidateRepos, true, "repository");
  checkBaseUrlDisagreements(candidateBaseUrls);

  const view =
    typeof root.github === "object" &&
    root.github !== null &&
    !Array.isArray(root.github)
      ? (root.github as Record<string, unknown>)
      : {};
  const result: Record<string, unknown> = { ...view };
  delete result.owner;
  delete result.org;
  delete result.organization;
  delete result.repo;
  delete result.githubToken;

  if (candidateTokens[0]?.value) result.token = candidateTokens[0].value;
  if (candidateOrgs[0]?.value) result.repoOwner = candidateOrgs[0].value;
  if (candidateRepos[0]?.value) result.repository = candidateRepos[0].value;
  if (candidateBaseUrls[0]?.value) result.baseUrl = candidateBaseUrls[0].value;

  return result;
}

function gatherAzureCandidates(root: Record<string, unknown>) {
  const candidateUrls: CandidateValue[] = [];
  const candidateOrgs: CandidateValue[] = [];
  const candidateProjects: CandidateValue[] = [];
  const candidatePats: CandidateValue[] = [];

  const inspectObj = (prefix: string, obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    if (isForeignProviderObject(rec, "azure")) return;

    extractMatchingKeys(rec, ["orgUrl"], prefix, candidateUrls);
    extractMatchingKeys(rec, ["organization", "org"], prefix, candidateOrgs);
    extractMatchingKeys(rec, ["project"], prefix, candidateProjects);
    extractMatchingKeys(rec, ["pat", "token"], prefix, candidatePats);
  };

  inspectObj("", root);
  inspectObj("azure.", root.azure);
  inspectObj("tracker.", root.tracker);
  inspectObj("gitHost.", root.gitHost);
  inspectObj("config.", root.config);

  return { candidateUrls, candidateOrgs, candidateProjects, candidatePats };
}

function checkAzureOrgUrlConsistency(
  candidateUrls: readonly CandidateValue[],
  candidateOrgs: readonly CandidateValue[],
): void {
  const firstUrl = candidateUrls[0];
  if (!firstUrl) return;

  const embeddedOrg = extractOrgNameFromUrl(firstUrl.value);
  if (!embeddedOrg) return;

  for (const { source, value } of candidateOrgs) {
    if (value.toLowerCase() !== embeddedOrg) {
      throw new Error(
        `Configuration mismatch: configured ${source} "${value}" and org in orgUrl "${embeddedOrg}" are distinct configurations and cannot be conflated.`,
      );
    }
  }

  for (let i = 1; i < candidateUrls.length; i++) {
    const next = candidateUrls[i];
    if (!next) continue;
    const nextEmbeddedOrg = extractOrgNameFromUrl(next.value);
    if (nextEmbeddedOrg && nextEmbeddedOrg !== embeddedOrg) {
      throw new Error(
        `Configuration mismatch: nested ${next.source} "${next.value}" has organization "${nextEmbeddedOrg}" which conflicts with orgUrl "${firstUrl.value}" ("${embeddedOrg}").`,
      );
    }
  }
}

function migrateAzureConfig(root: Record<string, unknown>): ProviderConfig {
  const { candidateUrls, candidateOrgs, candidateProjects, candidatePats } =
    gatherAzureCandidates(root);

  checkAzureOrgUrlConsistency(candidateUrls, candidateOrgs);
  checkDisagreements(candidateOrgs, true, "organization");
  checkDisagreements(candidateProjects, true, "project");
  checkDisagreements(candidatePats, false, "token");

  const view =
    typeof root.azure === "object" &&
    root.azure !== null &&
    !Array.isArray(root.azure)
      ? (root.azure as Record<string, unknown>)
      : {};
  const result: Record<string, unknown> = { ...view };
  delete result.org;
  delete result.organization;
  delete result.token;

  if (candidateUrls[0]?.value) {
    result.orgUrl = candidateUrls[0].value;
  } else if (candidateOrgs[0]?.value) {
    // A legacy record that names only the organization maps to its Azure URL.
    result.orgUrl = `https://dev.azure.com/${encodeURIComponent(candidateOrgs[0].value)}`;
  }
  if (candidateProjects[0]?.value) result.project = candidateProjects[0].value;
  if (candidatePats[0]?.value) result.pat = candidatePats[0].value;

  return result;
}

function migrateJiraConfig(root: Record<string, unknown>): ProviderConfig {
  const candidateHosts: CandidateValue[] = [];
  const candidateEmails: CandidateValue[] = [];
  const candidateProjects: CandidateValue[] = [];
  const candidateTokens: CandidateValue[] = [];

  const inspectObj = (prefix: string, obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    if (isForeignProviderObject(rec, "jira")) return;

    extractMatchingKeys(rec, ["host", "jiraHost"], prefix, candidateHosts);
    extractMatchingKeys(rec, ["email", "jiraEmail"], prefix, candidateEmails);
    extractMatchingKeys(
      rec,
      ["project", "projectId"],
      prefix,
      candidateProjects,
    );
    extractMatchingKeys(
      rec,
      ["apiToken", "token", "jiraToken"],
      prefix,
      candidateTokens,
    );
  };

  inspectObj("", root);
  inspectObj("jira.", root.jira);
  inspectObj("tracker.", root.tracker);
  inspectObj("config.", root.config);

  checkDisagreements(candidateHosts, true, "host");
  checkDisagreements(candidateEmails, true, "email");
  checkDisagreements(candidateProjects, true, "project");
  checkDisagreements(candidateTokens, false, "token");

  const view =
    typeof root.jira === "object" &&
    root.jira !== null &&
    !Array.isArray(root.jira)
      ? (root.jira as Record<string, unknown>)
      : {};
  const result: Record<string, unknown> = { ...view };

  if (candidateHosts[0]?.value) result.host = candidateHosts[0].value;
  if (candidateEmails[0]?.value) result.email = candidateEmails[0].value;
  if (candidateProjects[0]?.value) result.project = candidateProjects[0].value;
  if (candidateTokens[0]?.value) result.apiToken = candidateTokens[0].value;

  return result;
}

/**
 * Collapses legacy aliased keys and nested containers into a canonical typed config (#186).
 * Fails closed with a descriptive mismatch error when conflicting values are found.
 */
export function migrateLegacyProviderConfig(
  providerId: string,
  input: unknown,
): ProviderConfig {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  const root = input as Record<string, unknown>;

  switch (providerId) {
    case "github":
      return migrateGitHubConfig(root);
    case "azure":
      return migrateAzureConfig(root);
    case "jira":
      return migrateJiraConfig(root);
    default: {
      const view =
        root[providerId] !== null &&
        typeof root[providerId] === "object" &&
        !Array.isArray(root[providerId])
          ? (root[providerId] as Record<string, unknown>)
          : {};
      return { ...view };
    }
  }
}

/** Providers whose historical config shapes the migration step reconciles. */
const LEGACY_MIGRATED_PROVIDERS: ReadonlySet<string> = new Set([
  "github",
  "azure",
  "jira",
]);

/** Root keys the migration step consumes: aliases, URL hints and containers. */
const CONSUMED_ROOT_KEYS: ReadonlySet<string> = new Set([
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

/**
 * The migration step every config path runs before a config is typed (#186):
 * a provider with legacy shapes is reconciled (conflicts throw); any other
 * provider's config is already its typed shape and passes through unchanged.
 * Root keys the migration does not consume (for example `requiredLabel`) are
 * kept, so migrating a stored config never drops a field it does not own.
 */
export function migrateConfigForProvider(
  providerId: string,
  raw: unknown,
): ProviderConfig {
  const rootRecord =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (!LEGACY_MIGRATED_PROVIDERS.has(providerId)) return { ...rootRecord };
  const migrated = migrateLegacyProviderConfig(providerId, raw);
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rootRecord)) {
    if (!CONSUMED_ROOT_KEYS.has(key) && !(key in migrated)) kept[key] = value;
  }
  return { ...kept, ...migrated };
}
