// src/providers/jira-module.ts — Jira Cloud provider module (#140).
//
// Conforms to the unified Provider contract (#127, #134):
// - Declares zod configSchema with presentation metadata (.meta()) and envKey routing.
// - Required capabilities: verifyCredentials (with permission probe warnings) and toUserError.
// - Optional capabilities: listTickets (using /rest/api/3/search/jql) and parseQuickUrl.
// - Declares NO listRepositories capability (Jira Cloud is a tracker, not a git host).
// - Maps CAPTCHA responses (X-Seraph-LoginReason: AUTHENTICATION_DENIED) to AUTH_LOCKED.
// - Remediates the deprecated /rest/api/3/search endpoint in favor of /rest/api/3/search/jql.

import { z } from "zod/v4";
import type {
  Provider,
  ProviderConfig,
  ProviderConfigFieldMeta,
  ProviderError,
  ProviderErrorContext,
  QuickUrlDraft,
  TicketQueryOptions,
  TrackerTicket,
  VerificationResult,
  VerificationWarning,
} from "./contract.js";
import { REQUIRED_WORKFLOW_LABEL } from "./contract.js";

/** Remediated JQL search endpoint name constant (#140). */
export const SEARCH_JQL_ENDPOINT = "/rest/api/3/search/jql" as const;

/** Canonical search capability token (#140). */
export const SEARCH_JQL = "SEARCH_JQL" as const;

// ---------------------------------------------------------------------------
// Configuration Schema with presentation metadata
// ---------------------------------------------------------------------------

const hostMeta: ProviderConfigFieldMeta = {
  label: "Jira Host",
  uiType: "url",
  placeholder: "https://your-domain.atlassian.net",
  help: "Base URL of your Jira Cloud instance (e.g. https://company.atlassian.net).",
};

const emailMeta: ProviderConfigFieldMeta = {
  label: "Email",
  uiType: "email",
  placeholder: "user@example.com",
  help: "Email address associated with your Atlassian account.",
};

const apiTokenMeta: ProviderConfigFieldMeta = {
  label: "API Token",
  uiType: "secret",
  secret: true,
  envKey: "JIRA_API_TOKEN",
  placeholder: "Atlassian API token",
  help: "Atlassian API token generated from your Atlassian account security settings.",
};

const projectMeta: ProviderConfigFieldMeta = {
  label: "Project Key",
  uiType: "text",
  placeholder: "e.g. PROJ",
  help: "Optional Jira project key to scope ticket queries.",
};

export const jiraConfigSchema = z.object({
  host: z.string().min(1).meta(hostMeta),
  email: z.string().min(1).meta(emailMeta),
  apiToken: z.string().min(1).meta(apiTokenMeta),
  project: z.string().optional().meta(projectMeta),
});

export type JiraConfig = z.infer<typeof jiraConfigSchema>;

// ---------------------------------------------------------------------------
// HTTP Boundary & Error Types
// ---------------------------------------------------------------------------

export class JiraHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Headers,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "JiraHttpError";
  }
}

function cleanHost(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function buildBasicAuth(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString("base64");
}

function parseRetryAfterMs(
  headerValue: string | null | undefined,
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return diff > 0 ? diff : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Error Normalization (toUserError)
// ---------------------------------------------------------------------------

function extractHttpStatusAndHeaders(
  raw: unknown,
): { status: number; headers: Headers } | null {
  if (raw instanceof JiraHttpError) {
    return { status: raw.status, headers: raw.headers };
  }
  if (
    raw &&
    typeof raw === "object" &&
    "status" in raw &&
    typeof (raw as { status: unknown }).status === "number"
  ) {
    const httpLike = raw as { status: number; headers?: unknown };
    const headers =
      httpLike.headers instanceof Headers ? httpLike.headers : new Headers();
    return { status: httpLike.status, headers };
  }
  return null;
}

function mapStatusToProviderError(
  status: number,
  headers: Headers,
  context: ProviderErrorContext,
): ProviderError {
  const seraphReason = headers.get("x-seraph-loginreason") ?? "";
  if (/AUTHENTICATION_DENIED/i.test(seraphReason)) {
    return { code: "AUTH_LOCKED", context };
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(headers.get("retry-after"));
    return {
      code: "RATE_LIMITED",
      context,
      ...(retryAfterMs !== undefined && retryAfterMs > 0
        ? { retryAfterMs }
        : {}),
    };
  }
  if (status === 401) return { code: "AUTH_INVALID", context };
  if (status === 403) return { code: "PERMISSION", context };
  if (status === 404) return { code: "NOT_FOUND", context };
  return { code: "UNKNOWN", context };
}

function mapErrorMessageToProviderError(
  message: string,
  context: ProviderErrorContext,
): ProviderError {
  if (/AUTHENTICATION_DENIED|captcha/i.test(message)) {
    return { code: "AUTH_LOCKED", context };
  }
  if (/429|rate limit/i.test(message)) return { code: "RATE_LIMITED", context };
  if (/401|unauthorized/i.test(message))
    return { code: "AUTH_INVALID", context };
  if (/403|forbidden/i.test(message)) return { code: "PERMISSION", context };
  if (/404|not found/i.test(message)) return { code: "NOT_FOUND", context };
  return { code: "UNKNOWN", context };
}

export function toJiraUserError(
  raw: unknown,
  context: ProviderErrorContext,
): ProviderError {
  const http = extractHttpStatusAndHeaders(raw);
  if (http) {
    return mapStatusToProviderError(http.status, http.headers, context);
  }

  if (raw instanceof Error) {
    return mapErrorMessageToProviderError(raw.message, context);
  }

  return { code: "UNKNOWN", context };
}

// ---------------------------------------------------------------------------
// Quick-URL Intake (parseQuickUrl)
// ---------------------------------------------------------------------------

export function parseJiraQuickUrl(url: string): QuickUrlDraft | null {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  // Must match *.atlassian.net hostname
  const hostMatch = /^([a-zA-Z0-9-]+)\.atlassian\.net$/i.exec(parsed.hostname);
  if (!hostMatch) {
    return null;
  }

  const subdomain = hostMatch[1];
  if (!subdomain) {
    return null;
  }
  const host = `https://${subdomain}.atlassian.net`;

  // Infer project key from common Jira Cloud URL pathname patterns:
  // - /browse/PROJ-123
  // - /projects/PROJ
  // - /jira/software/projects/PROJ/...
  // - /jira/software/c/projects/PROJ/...
  let projectKey: string | undefined;

  const browseMatch = /\/browse\/([a-zA-Z0-9]+)-\d+/i.exec(parsed.pathname);
  if (browseMatch?.[1]) {
    projectKey = browseMatch[1].toUpperCase();
  } else {
    const projectMatch = /\/projects\/([a-zA-Z0-9]+)/i.exec(parsed.pathname);
    if (projectMatch?.[1]) {
      projectKey = projectMatch[1].toUpperCase();
    }
  }

  const configDraft: ProviderConfig = {
    host,
    ...(projectKey ? { project: projectKey } : {}),
  };

  const inferredName = projectKey || subdomain;

  return {
    configDraft,
    inferredName,
  };
}

// ---------------------------------------------------------------------------
// ADF Parsing & Acceptance Criteria Extraction
// ---------------------------------------------------------------------------

export function parseAdfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") {
    return obj.text;
  }
  if (Array.isArray(obj.content)) {
    const pieces = obj.content.map(parseAdfToText);
    if (obj.type === "bulletList") {
      return pieces.map((p) => `- ${p.trim()}`).join("\n");
    }
    if (obj.type === "paragraph" || obj.type === "heading") {
      return `${pieces.join("")}\n`;
    }
    return pieces.join(" ");
  }
  return "";
}

function isSectionHeader(line: string): boolean {
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    line,
  );
}

function sanitizeCriteriaLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function parseBulletLine(line: string): string | null {
  const match = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match?.[1] ? sanitizeCriteriaLine(match[1]) : null;
}

export function extractCriteria(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const headerIdx = lines.findIndex(isSectionHeader);

  if (headerIdx >= 0) {
    const sectionLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) continue;
      if (/^#+\s+/.test(currentLine)) break;
      const bullet = parseBulletLine(currentLine);
      if (bullet) {
        sectionLines.push(bullet);
      } else if (currentLine.length > 5) {
        sectionLines.push(sanitizeCriteriaLine(currentLine));
      }
    }
    return sectionLines;
  }

  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export const jiraProvider: Provider<"jira"> = {
  id: "jira",
  displayName: "Jira Cloud",
  roles: ["tracker"] as const,
  iconRef: "provider-jira",
  configSchema: jiraConfigSchema,

  async verifyCredentials(config: ProviderConfig): Promise<VerificationResult> {
    const parsed = jiraConfigSchema.parse(config);
    const host = cleanHost(parsed.host);
    const auth = buildBasicAuth(parsed.email, parsed.apiToken);

    // 1. Primary credential verification via GET /rest/api/3/myself
    const myselfUrl = `https://${host}/rest/api/3/myself`;
    const res = await fetch(myselfUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // non-JSON body
      }
      throw new JiraHttpError(
        `Jira credential verification failed: HTTP ${res.status}`,
        res.status,
        res.headers,
        body,
      );
    }

    // 2. Behavioral permission probe via GET /rest/api/3/mypermissions
    // Checks BROWSE_PROJECTS (and projectKey if configured)
    const warnings: VerificationWarning[] = [];
    try {
      const queryParams = new URLSearchParams({
        permissions: "BROWSE_PROJECTS",
      });
      if (parsed.project && parsed.project.trim().length > 0) {
        queryParams.set("projectKey", parsed.project.trim());
      }

      const probeUrl = `https://${host}/rest/api/3/mypermissions?${queryParams.toString()}`;
      const probeRes = await fetch(probeUrl, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      if (!probeRes.ok) {
        // Inconclusive / probe failure degrades gracefully
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "listTickets",
        });
      } else {
        const probeData = (await probeRes.json()) as {
          permissions?: {
            BROWSE_PROJECTS?: { havePermission?: boolean };
          };
        };
        const hasBrowse =
          probeData?.permissions?.BROWSE_PROJECTS?.havePermission === true;
        if (!hasBrowse) {
          warnings.push({
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "listTickets",
          });
        }
      }
    } catch {
      // Best-effort probe failure is evidence of degradation, not a hard error
      warnings.push({
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listTickets",
      });
    }

    if (warnings.length > 0) {
      return {
        status: "degraded",
        warnings,
      };
    }

    return {
      status: "ok",
      warnings: [],
    };
  },

  toUserError(raw: unknown, context: ProviderErrorContext): ProviderError {
    return toJiraUserError(raw, context);
  },

  async listTickets(
    config: ProviderConfig,
    options: TicketQueryOptions,
  ): Promise<TrackerTicket[]> {
    const parsed = jiraConfigSchema.parse(config);
    const host = cleanHost(parsed.host);
    const auth = buildBasicAuth(parsed.email, parsed.apiToken);
    const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
    const project =
      typeof parsed.project === "string" && parsed.project.trim().length > 0
        ? parsed.project.trim()
        : undefined;
    const limit = 50;

    // Remediated JQL query using the modern /rest/api/3/search/jql endpoint
    const jql = `labels = "${label}"${project ? ` AND project = "${project}"` : ""} AND statusCategory != Done ORDER BY updated DESC`;
    const searchUrl = `https://${host}${SEARCH_JQL_ENDPOINT}?jql=${encodeURIComponent(jql)}&maxResults=${limit}`;

    const res = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // non-JSON body
      }
      throw new JiraHttpError(
        `Jira search/jql failed: HTTP ${res.status}`,
        res.status,
        res.headers,
        body,
      );
    }

    const raw = (await res.json()) as {
      issues?: Array<{
        key: string;
        fields?: {
          summary?: string;
          description?: unknown;
          labels?: string[];
        };
      }>;
    };

    const issues = raw.issues ?? [];
    return issues.map((issue) => {
      let desc = "";
      if (typeof issue.fields?.description === "string") {
        desc = issue.fields.description;
      } else if (issue.fields?.description) {
        desc = parseAdfToText(issue.fields.description);
      }

      const labels = Array.isArray(issue.fields?.labels)
        ? issue.fields.labels
        : [];
      return {
        id: issue.key,
        title: issue.fields?.summary || "",
        description: desc,
        acceptanceCriteria: extractCriteria(desc),
        labels,
        url: `https://${host}/browse/${issue.key}`,
        provider: "jira" as const,
      };
    });
  },

  parseQuickUrl(url: string): QuickUrlDraft | null {
    return parseJiraQuickUrl(url);
  },
};
