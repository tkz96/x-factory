// src/providers/azure-module.ts — Azure DevOps provider implementation.
//
// Wayfinder #127 / Ticket #139:
// - Provider-conformant module satisfying Provider<"azure"> contract
// - Zod configSchema with envKey secret metadata (passes serializer gate)
// - Defect H2 fix: organization vs orgUrl mismatch detection
// - Internal auth acquisition (PAT Basic, JWT Bearer, Azure CLI fallback)
// - HTML-on-2xx normalization (auth wall detection)
// - CAPABILITY_UNCONFIRMED degraded verification probes
// - REST-primary PR creation conforming to PR_CREATE_ONLY
// - parseQuickUrl pre-fills both tracker and git-host drafts

import { z } from "zod/v4";
import {
  type CreatePullRequestInput,
  type FindPullRequestInput,
  PR_CREATE_ONLY,
  type Provider,
  type ProviderConfig,
  type ProviderError,
  type ProviderErrorContext,
  type ProviderPullRequest,
  type ProviderRepository,
  REQUIRED_WORKFLOW_LABEL,
  type ScopeFinding,
  type ScopeVerificationReport,
  type TicketQueryOptions,
  type TrackerTicket,
  type VerificationResult,
  type VerificationWarning,
} from "./contract.js";

/** Safety invariant: Azure provider PR creation is create-only. */
export const AZURE_PR_POLICY = PR_CREATE_ONLY;

/** Provider configuration schema for Azure DevOps. Passes serializer gate. */
export const azureConfigSchema = z.object({
  orgUrl: z.string().url().meta({
    label: "Organization URL",
    uiType: "url",
    placeholder: "https://dev.azure.com/organization",
    help: "Azure DevOps organization URL (e.g. https://dev.azure.com/your-org)",
  }),
  project: z.string().min(1).meta({
    label: "Project",
    uiType: "text",
    placeholder: "MyProject",
    help: "Azure DevOps project name",
  }),
  pat: z.string().min(1).meta({
    label: "Personal Access Token",
    uiType: "secret",
    secret: true,
    envKey: "AZURE_DEVOPS_PAT",
    placeholder: "••••••••",
    help: "Personal Access Token with Code and Work Items scopes",
  }),
});

/**
 * Provider-internal API error class preserving HTTP status, headers, and classification.
 * The raw error never crosses the provider/API boundary — translated via toUserError.
 */
export class AzureApiError extends Error {
  readonly status?: number | undefined;
  readonly headers?: Headers | undefined;
  readonly isHtml?: boolean | undefined;
  readonly isRateLimit?: boolean | undefined;
  readonly retryAfterMs?: number | undefined;

  constructor(
    message: string,
    options?: {
      status?: number | undefined;
      headers?: Headers | undefined;
      isHtml?: boolean | undefined;
      isRateLimit?: boolean | undefined;
      retryAfterMs?: number | undefined;
    },
  ) {
    super(message);
    this.name = "AzureApiError";
    this.status = options?.status;
    this.headers = options?.headers;
    this.isHtml = options?.isHtml;
    this.isRateLimit = options?.isRateLimit;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * Extract canonical organization name from an Azure DevOps URL.
 */
export function extractOrgNameFromUrl(orgUrl: string): string | null {
  const trimmed = orgUrl.trim().replace(/\/+$/, "");
  // dev.azure.com/<org>
  const devAzureMatch = trimmed.match(
    /^(?:https?:\/\/)?dev\.azure\.com\/([^/]+)/i,
  );
  if (devAzureMatch?.[1]) {
    return decodeURIComponent(devAzureMatch[1]).toLowerCase();
  }
  // <org>.visualstudio.com
  const vsMatch = trimmed.match(/^(?:https?:\/\/)?([^.]+)\.visualstudio\.com/i);
  if (vsMatch?.[1]) {
    return decodeURIComponent(vsMatch[1]).toLowerCase();
  }
  // ssh.dev.azure.com:v3/<org>
  const sshMatch = trimmed.match(/^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)/i);
  if (sshMatch?.[1]) {
    return decodeURIComponent(sshMatch[1]).toLowerCase();
  }
  return null;
}

/**
 * Defect H2 fix: Detect organization vs orgUrl configuration mismatch.
 *
 * Detects whether the configured organization and the org embedded in orgUrl
 * are distinct configurations (also honoring #129 nested-config detection),
 * ensuring they are NEVER silently conflated.
 */
export function detectOrganizationMismatch(config: Record<string, unknown>): {
  mismatch: boolean;
  error?: string;
} {
  const rawOrgUrl =
    typeof config.orgUrl === "string" ? config.orgUrl.trim() : "";
  if (!rawOrgUrl) {
    return { mismatch: false };
  }

  const embeddedOrg = extractOrgNameFromUrl(rawOrgUrl);
  if (!embeddedOrg) {
    return { mismatch: false };
  }

  // Gather explicit organization candidates across top-level and nested config objects
  const candidateOrgs: Array<{ source: string; value: string }> = [];
  const candidateUrls: Array<{ source: string; value: string }> = [];

  const inspect = (prefix: string, obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.organization === "string" && rec.organization.trim()) {
      candidateOrgs.push({
        source: `${prefix}organization`,
        value: rec.organization.trim(),
      });
    }
    if (typeof rec.org === "string" && rec.org.trim()) {
      candidateOrgs.push({ source: `${prefix}org`, value: rec.org.trim() });
    }
    if (typeof rec.orgUrl === "string" && rec.orgUrl.trim()) {
      candidateUrls.push({
        source: `${prefix}orgUrl`,
        value: rec.orgUrl.trim(),
      });
    }
  };

  inspect("", config);
  inspect("azure.", config.azure);
  inspect("tracker.", config.tracker);
  inspect("gitHost.", config.gitHost);

  // Check for mismatched org names
  for (const { source, value } of candidateOrgs) {
    const normalizedCandidate = value.toLowerCase();
    if (normalizedCandidate !== embeddedOrg) {
      return {
        mismatch: true,
        error: `Configuration mismatch: configured ${source} "${value}" and org in orgUrl "${embeddedOrg}" are distinct configurations and cannot be conflated.`,
      };
    }
  }

  // Check for nested orgUrls conflicting with top-level orgUrl
  for (const { source, value } of candidateUrls) {
    if (source === "orgUrl") continue;
    const nestedEmbeddedOrg = extractOrgNameFromUrl(value);
    if (nestedEmbeddedOrg && nestedEmbeddedOrg !== embeddedOrg) {
      return {
        mismatch: true,
        error: `Configuration mismatch: nested ${source} "${value}" has organization "${nestedEmbeddedOrg}" which conflicts with orgUrl "${rawOrgUrl}" ("${embeddedOrg}").`,
      };
    }
  }

  return { mismatch: false };
}

/**
 * Resolve an Authorization header internal to the module.
 * PAT → Basic auth, JWT → Bearer auth, Azure CLI fallback if no direct credential.
 */
export async function resolveAzureAuth(
  pat?: string,
  executor?: CliCommandExecutor,
): Promise<string> {
  const trimmed = pat?.trim();
  if (trimmed) {
    return formatAzureAuthHeader(trimmed);
  }
  return getAzureCliAuthHeader(executor);
}

/**
 * Detect HTML response content on 2xx or 203 (Azure portal redirect / AAD login challenge).
 */
export function isHtmlResponse(
  contentType?: string | null,
  text?: string,
): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  if (!text) return false;
  const trimmed = text.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body") ||
    /<(?:!doctype\s+html|html|head|body)[^>]*>/i.test(text)
  );
}

function parseRetryAfter(headerValue?: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return undefined;
}

export interface AzureFetchOptions extends RequestInit {
  fetchFn?: typeof fetch;
}

/**
 * HTTP helper normalizing HTML on 2xx and Azure API errors into AzureApiError.
 */
export async function azureFetch(
  url: string,
  options: AzureFetchOptions = {},
): Promise<{ status: number; text: string; data: unknown; headers: Headers }> {
  const fetcher = options.fetchFn || globalThis.fetch;
  const res = await fetcher(url, options);
  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();

  if (
    res.status === 203 ||
    isHtmlResponse(contentType, bodyText) ||
    (res.redirected &&
      (res.url.includes("login.microsoftonline.com") ||
        res.url.includes("signin")))
  ) {
    throw new AzureApiError(
      "Azure DevOps returned an HTML sign-in page or authentication redirect.",
      {
        status: res.status,
        headers: res.headers,
        isHtml: true,
      },
    );
  }

  if (!res.ok) {
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    const isRate = res.status === 429 || bodyText.includes("TF400733");
    throw new AzureApiError(
      `Azure DevOps request failed with status ${res.status}: ${bodyText.slice(0, 300)}`,
      {
        status: res.status,
        headers: res.headers,
        isRateLimit: isRate,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      },
    );
  }

  let data: unknown = null;
  if (bodyText.trim()) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      // not JSON
    }
  }

  return {
    status: res.status,
    text: bodyText,
    data,
    headers: res.headers,
  };
}

/**
 * Normalizes provider-specific status/body/header semantics into the provider error envelope.
 * No provider-generated message, body text, or header name crosses this boundary.
 */
export function toUserError(
  raw: unknown,
  context: ProviderErrorContext,
): ProviderError {
  if (
    raw &&
    typeof raw === "object" &&
    "code" in raw &&
    "context" in raw &&
    typeof (raw as Record<string, unknown>).code === "string" &&
    typeof (raw as Record<string, unknown>).context === "string"
  ) {
    return raw as ProviderError;
  }

  let status: number | undefined;
  let message = "";
  let isHtml = false;
  let isRateLimit = false;
  let retryAfterMs: number | undefined;

  if (raw instanceof AzureApiError) {
    status = raw.status;
    message = raw.message;
    isHtml = raw.isHtml ?? false;
    isRateLimit = raw.isRateLimit ?? false;
    retryAfterMs = raw.retryAfterMs;
  } else if (raw instanceof Error) {
    message = raw.message;
    if (
      "status" in raw &&
      typeof (raw as Record<string, unknown>).status === "number"
    ) {
      status = (raw as Record<string, unknown>).status as number;
    }
  } else if (typeof raw === "string") {
    message = raw;
  }

  // 1. Semantic Status Classification (Highest Precedence)
  if (status === 401 || status === 203 || isHtml) {
    return { code: "AUTH_INVALID", context };
  }
  if (status === 403) {
    return { code: "PERMISSION", context };
  }
  if (status === 404) {
    return { code: "NOT_FOUND", context };
  }
  if (status === 429 || isRateLimit) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0
        ? { retryAfterMs }
        : {}),
    };
  }

  // 2. Message Heuristics Fallback
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("tf400733") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("too many requests")
  ) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0
        ? { retryAfterMs }
        : {}),
    };
  }

  if (
    lowerMsg.includes("auth") ||
    lowerMsg.includes("token") ||
    lowerMsg.includes("pat") ||
    lowerMsg.includes("sign-in") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("html response")
  ) {
    return { code: "AUTH_INVALID", context };
  }

  if (
    lowerMsg.includes("forbidden") ||
    lowerMsg.includes("permission") ||
    lowerMsg.includes("tf401027")
  ) {
    return { code: "PERMISSION", context };
  }

  if (lowerMsg.includes("not found")) {
    return { code: "NOT_FOUND", context };
  }

  return {
    code: "UNKNOWN",
    context,
  };
}

/** Dependencies for provider injection in unit tests */
export interface AzureProviderDependencies {
  fetchFn?: typeof fetch;
  executor?: CliCommandExecutor;
}

interface ResolvedAzureContext {
  orgUrl: string;
  project: string;
  cleanOrgUrl: string;
  encodedProject: string;
  authHeader: string;
}

async function prepareAzureContext(
  config: ProviderConfig,
  executor: CliCommandExecutor | undefined,
  authErrorMessage = "Authentication required. Enter an Azure PAT or sign in with Azure CLI.",
): Promise<ResolvedAzureContext> {
  const parsed = azureConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid Azure configuration: ${parsed.error.message}`);
  }

  const { orgUrl, project, pat } = parsed.data;
  const cleanOrgUrl = orgUrl.trim().replace(/\/+$/, "");
  const authHeader = await resolveAzureAuth(pat, executor);
  if (!authHeader) {
    throw new AzureApiError(authErrorMessage, { status: 401 });
  }

  return {
    orgUrl,
    project,
    cleanOrgUrl,
    encodedProject: encodeURIComponent(project),
    authHeader,
  };
}

/**
 * Creates an Azure DevOps Provider instance with optional injected dependencies.
 */
export function createAzureProvider(
  deps: AzureProviderDependencies = {},
): Provider<"azure"> {
  const getFetcher = () => deps.fetchFn || globalThis.fetch;
  const executor = deps.executor;

  return {
    id: "azure",
    displayName: "Azure DevOps",
    roles: ["tracker", "gitHost"] as const,
    iconRef: "provider-azure",
    configSchema: azureConfigSchema,

    toUserError,

    async verifyCredentials(
      config: ProviderConfig,
    ): Promise<VerificationResult> {
      // 1. Defect H2 fix: Detect organization vs orgUrl mismatch
      const mismatch = detectOrganizationMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(config, executor);
      const warnings: VerificationWarning[] = [];

      // 4. Probe 1: Repositories read (authoritative check for project & repos)
      let repos: Array<{ id: string; name: string }> = [];
      const reposUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;

      try {
        const reposRes = await azureFetch(reposUrl, {
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          fetchFn: getFetcher(),
          signal: AbortSignal.timeout(6000),
        });

        const reposPayload = reposRes.data as
          | { value?: unknown[] }
          | null
          | undefined;
        if (Array.isArray(reposPayload?.value)) {
          repos = reposPayload.value.map((r: unknown) => {
            const item = (r && typeof r === "object" ? r : {}) as Record<
              string,
              unknown
            >;
            return {
              id: String(item.id ?? ""),
              name: String(item.name ?? ""),
            };
          });
        }
      } catch (err) {
        if (
          err instanceof AzureApiError &&
          (err.status === 401 || err.isHtml)
        ) {
          throw err;
        }
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "listRepositories",
        });
      }

      // 5. Probe 2: Work Items read (WIQL probe for tickets capability)
      try {
        const wiqlUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
        const wiqlRes = await getFetcher()(wiqlUrl, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id] DESC`,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (
          wiqlRes.status === 401 ||
          isHtmlResponse(wiqlRes.headers.get("content-type"))
        ) {
          throw new AzureApiError(
            "Authentication invalid on work items probe",
            { status: 401 },
          );
        }
        if (wiqlRes.status === 403) {
          warnings.push({
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "listTickets",
          });
        }
      } catch (err) {
        if (err instanceof AzureApiError && err.status === 401) {
          throw err;
        }
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "listTickets",
        });
      }

      // 6. Probe 3: Pull Request write capability probe
      const targetRepo = repos[0]?.id || repos[0]?.name;
      if (!targetRepo) {
        // No repo in project to probe PR write on
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        });
      } else {
        try {
          const prProbeUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(targetRepo)}/pullrequests?api-version=7.1`;
          const prRes = await getFetcher()(prProbeUrl, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              sourceRefName: "refs/heads/_xfactory_probe_nonexistent_src_",
              targetRefName: "refs/heads/_xfactory_probe_nonexistent_tgt_",
              title: "x-factory probe",
            }),
            signal: AbortSignal.timeout(5000),
          });

          const prContentType = prRes.headers.get("content-type") || "";
          if (prRes.status === 401 || isHtmlResponse(prContentType)) {
            warnings.push({
              kind: "CAPABILITY_UNCONFIRMED",
              capability: "createPullRequest",
            });
          } else if (prRes.status === 403) {
            // Read-only PAT cannot create PRs
            warnings.push({
              kind: "CAPABILITY_UNCONFIRMED",
              capability: "createPullRequest",
            });
          }
          // Note: 400 or 404 indicates authorized access reached the git service (branches don't exist)
        } catch {
          warnings.push({
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "createPullRequest",
          });
        }
      }

      if (warnings.length > 0) {
        return { status: "degraded", warnings };
      }

      return { status: "ok", warnings: [] };
    },

    async verifyScopes(
      config: ProviderConfig,
    ): Promise<ScopeVerificationReport> {
      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(
          config,
          executor,
          "Authentication required for scope verification.",
        );

      const findings: ScopeFinding[] = [];
      let overPrivileged = false;

      // 1. Tickets (Work Items) read
      try {
        const wiqlUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
        const res = await getFetcher()(wiqlUrl, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project`,
          }),
        });
        findings.push({
          capability: "listTickets",
          status:
            res.status === 200
              ? "confirmed"
              : res.status === 403
                ? "missing"
                : "unconfirmed",
        });
      } catch {
        findings.push({ capability: "listTickets", status: "unconfirmed" });
      }

      // 2. Repositories read & PR probe
      let firstRepoIdOrName: string | undefined;
      try {
        const reposUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
        const res = await getFetcher()(reposUrl, {
          headers: { Authorization: authHeader, Accept: "application/json" },
        });
        if (res.status === 200) {
          findings.push({
            capability: "listRepositories",
            status: "confirmed",
          });
          const json = (await res.json()) as {
            value?: Array<{ id: string; name: string }>;
          };
          firstRepoIdOrName = json.value?.[0]?.id || json.value?.[0]?.name;
        } else {
          findings.push({
            capability: "listRepositories",
            status: res.status === 403 ? "missing" : "unconfirmed",
          });
        }
      } catch {
        findings.push({
          capability: "listRepositories",
          status: "unconfirmed",
        });
      }

      // 3. PR creation write probe
      if (firstRepoIdOrName) {
        try {
          const prProbeUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(firstRepoIdOrName)}/pullrequests?api-version=7.1`;
          const res = await getFetcher()(prProbeUrl, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              sourceRefName: "refs/heads/_probe_src_",
              targetRefName: "refs/heads/_probe_tgt_",
              title: "probe",
            }),
          });
          findings.push({
            capability: "createPullRequest",
            status:
              res.status === 400 || res.status === 404 || res.status === 200
                ? "confirmed"
                : res.status === 403
                  ? "missing"
                  : "unconfirmed",
          });
        } catch {
          findings.push({
            capability: "createPullRequest",
            status: "unconfirmed",
          });
        }
      } else {
        findings.push({
          capability: "createPullRequest",
          status: "unconfirmed",
        });
      }

      // 4. Overprivilege checks: recycle bin (Code: Full) and work item write
      try {
        const binUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/recycleBin/repositories?api-version=7.1`;
        const res = await getFetcher()(binUrl, {
          headers: { Authorization: authHeader, Accept: "application/json" },
        });
        if (res.status === 200) {
          overPrivileged = true;
        }
      } catch {
        // ignore
      }

      try {
        const writeProbeUrl = `${cleanOrgUrl}/_apis/wit/workitems/-1?api-version=7.1`;
        const res = await getFetcher()(writeProbeUrl, {
          method: "PATCH",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json-patch+json",
            Accept: "application/json",
          },
          body: JSON.stringify([
            {
              op: "add",
              path: "/fields/System.Title",
              value: "x-factory-scope-probe",
            },
          ]),
        });
        if (res.status === 200 || res.status === 404) {
          overPrivileged = true;
        }
      } catch {
        // ignore
      }

      findings.push({ capability: "verifyScopes", status: "confirmed" });

      return {
        findings,
        overPrivileged,
      };
    },

    parseQuickUrl(url: string) {
      const trimmed = url.trim();
      if (!trimmed) return null;

      // 1. dev.azure.com/<org>/<project>(/_git/<repo>)?
      const devAzureMatch = trimmed.match(
        /^(?:https?:\/\/)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/([^/]+))?/i,
      );
      if (devAzureMatch?.[1] && devAzureMatch[2]) {
        const org = devAzureMatch[1];
        const project = decodeURIComponent(devAzureMatch[2]);
        const repo = devAzureMatch[3]
          ? decodeURIComponent(devAzureMatch[3])
          : undefined;
        return {
          configDraft: {
            orgUrl: `https://dev.azure.com/${org}`,
            project,
          },
          inferredName: repo || project,
        };
      }

      // 2. <org>.visualstudio.com/<project>(/_git/<repo>)?
      const vsMatch = trimmed.match(
        /^(?:https?:\/\/)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/([^/]+))?/i,
      );
      if (vsMatch?.[1] && vsMatch[2]) {
        const org = vsMatch[1];
        const project = decodeURIComponent(vsMatch[2]);
        const repo = vsMatch[3] ? decodeURIComponent(vsMatch[3]) : undefined;
        return {
          configDraft: {
            orgUrl: `https://${org}.visualstudio.com`,
            project,
          },
          inferredName: repo || project,
        };
      }

      // 3. ssh.dev.azure.com:v3/<org>/<project>/<repo>
      const sshMatch = trimmed.match(
        /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
      );
      if (sshMatch?.[1] && sshMatch[2] && sshMatch[3]) {
        const org = sshMatch[1];
        const project = decodeURIComponent(sshMatch[2]);
        const repo = decodeURIComponent(sshMatch[3]);
        return {
          configDraft: {
            orgUrl: `https://dev.azure.com/${org}`,
            project,
          },
          inferredName: repo || project,
        };
      }

      return null;
    },

    async listRepositories(
      config: ProviderConfig,
    ): Promise<ProviderRepository[]> {
      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(
          config,
          executor,
          "Authentication required to list repositories.",
        );

      const url = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
      const res = await azureFetch(url, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
        fetchFn: getFetcher(),
      });

      const rawData = res.data as { value?: unknown[] } | null | undefined;
      const value = Array.isArray(rawData?.value) ? rawData.value : [];
      return value.map((item: unknown) => {
        const r = (item && typeof item === "object" ? item : {}) as Record<
          string,
          unknown
        >;
        return {
          id: String(r.id ?? ""),
          name: String(r.name ?? ""),
          remote: String(r.remoteUrl ?? r.url ?? r.webUrl ?? ""),
          defaultBranch:
            typeof r.defaultBranch === "string"
              ? r.defaultBranch.replace(/^refs\/heads\//, "")
              : "main",
          ...(typeof r.webUrl === "string" ? { webUrl: r.webUrl } : {}),
        };
      });
    },

    async listTickets(
      config: ProviderConfig,
      options: TicketQueryOptions,
    ): Promise<TrackerTicket[]> {
      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(
          config,
          undefined,
          "Azure DevOps authentication required.",
        );

      const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
      const escapedLabel = label.replace(/'/g, "''");
      const wiqlUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS '${escapedLabel}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC`;

      const res = await azureFetch(wiqlUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        fetchFn: getFetcher(),
      });

      const raw = res.data as { workItems?: Array<{ id: number }> };
      if (!raw || !Array.isArray(raw.workItems) || raw.workItems.length === 0)
        return [];

      const ids = raw.workItems.map((w) => w.id).slice(0, 50);
      if (ids.length === 0) return [];

      const itemsUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.1`;
      const itemsRes = await azureFetch(itemsUrl, {
        headers: { Authorization: authHeader, Accept: "application/json" },
        fetchFn: getFetcher(),
      });

      const itemsRaw = itemsRes.data as {
        value?: Array<Record<string, unknown>>;
      };
      const items = Array.isArray(itemsRaw?.value) ? itemsRaw.value : [];

      return items.map((item: Record<string, unknown>) => {
        const fields = (item.fields as Record<string, unknown>) || {};
        const title = String(fields["System.Title"] || "");
        const rawDesc = String(fields["System.Description"] || "");
        const rawCriteria = String(
          fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
        );
        const desc = stripHtml(rawDesc);
        const criteriaText = rawCriteria ? stripHtml(rawCriteria) : desc;
        let criteria = extractCriteria(criteriaText);
        if (criteria.length === 0 && rawCriteria) {
          const stripped = stripHtml(rawCriteria).trim();
          if (stripped) {
            criteria = stripped
              .split(/\r?\n/)
              .map((s: string) => s.trim())
              .filter(Boolean);
          }
        }
        const tags = String(fields["System.Tags"] || "")
          .split(";")
          .map((s: string) => s.trim())
          .filter(Boolean);

        const fallbackUrl = `${cleanOrgUrl}/${encodedProject}/_workitems/edit/${item.id}`;

        return {
          id: `AZ-${item.id}`,
          title,
          description: desc,
          acceptanceCriteria: criteria,
          labels: tags,
          url:
            (item._links as { html?: { href?: string } })?.html?.href ||
            fallbackUrl,
          provider: "azure" as const,
        };
      });
    },

    async createPullRequest(
      config: ProviderConfig,
      input: CreatePullRequestInput,
    ): Promise<ProviderPullRequest> {
      // Safety invariant: X-Factory creates pull requests, never merges or closes them
      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(
          config,
          executor,
          "Authentication required to create pull request.",
        );

      const endpoint = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(input.repository)}/pullrequests?api-version=7.1`;

      const payload = {
        sourceRefName: normalizeGitRef(input.sourceBranch),
        targetRefName: normalizeGitRef(input.targetBranch),
        title: input.title,
        description: input.description,
      };

      const res = await azureFetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        fetchFn: getFetcher(),
      });

      const data = (
        res.data && typeof res.data === "object" ? res.data : {}
      ) as Record<string, unknown>;
      const pullRequestId = data.pullRequestId
        ? String(data.pullRequestId)
        : "";
      const links = data._links as { web?: { href?: string } } | undefined;
      let webUrl = typeof links?.web?.href === "string" ? links.web.href : "";
      if (!webUrl && pullRequestId) {
        webUrl = `${cleanOrgUrl}/${encodedProject}/_git/${encodeURIComponent(input.repository)}/pullrequest/${pullRequestId}`;
      }

      return {
        url: webUrl || (typeof data.url === "string" ? data.url : ""),
        status: (typeof data.status === "string" ? data.status : "active") as
          | "active"
          | "completed"
          | "abandoned",
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
      };
    },

    async findExistingPullRequest(
      config: ProviderConfig,
      input: FindPullRequestInput,
    ): Promise<ProviderPullRequest | null> {
      const { cleanOrgUrl, encodedProject, authHeader } =
        await prepareAzureContext(
          config,
          executor,
          "Authentication required to search pull requests.",
        );

      const sourceRef = normalizeGitRef(input.sourceBranch);
      const endpoint = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(input.repository)}/pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&api-version=7.1`;

      const res = await azureFetch(endpoint, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
        fetchFn: getFetcher(),
      });

      const prsPayload = res.data as { value?: unknown[] } | null | undefined;
      const prs = Array.isArray(prsPayload?.value) ? prsPayload.value : [];
      if (prs.length === 0) {
        return null;
      }

      const pr = (prs[0] && typeof prs[0] === "object" ? prs[0] : {}) as Record<
        string,
        unknown
      >;
      const prLinks = pr._links as { web?: { href?: string } } | undefined;
      let webUrl = prLinks?.web?.href || "";
      const prId = pr.pullRequestId ? String(pr.pullRequestId) : "";
      if (!webUrl && prId) {
        webUrl = `${cleanOrgUrl}/${encodedProject}/_git/${encodeURIComponent(input.repository)}/pullrequest/${prId}`;
      }

      const targetRef =
        typeof pr.targetRefName === "string" ? pr.targetRefName : "";
      const lastCommit = pr.lastMergeSourceCommit as
        | { commitId?: string }
        | undefined;

      return {
        url: webUrl || (typeof pr.url === "string" ? pr.url : ""),
        status: (typeof pr.status === "string" ? pr.status : "active") as
          | "active"
          | "completed"
          | "abandoned",
        sourceBranch: input.sourceBranch,
        targetBranch: targetRef.replace(/^refs\/heads\//, ""),
        ...(lastCommit?.commitId
          ? { lastMergeSourceCommit: lastCommit.commitId }
          : {}),
      };
    },
  };
}

/** Production Azure DevOps provider singleton */
export const azureProvider: Provider<"azure"> = createAzureProvider();
export type CliCommandExecutor = (
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ passed: boolean; stdout: string }>;

export function formatAzureAuthHeader(pat: string): string {
  const trimmed = pat.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("eyJ")
    ? `Bearer ${trimmed}`
    : `Basic ${Buffer.from(`:${trimmed}`).toString("base64")}`;
}

export async function getAzureCliAuthHeader(
  executor?: CliCommandExecutor,
): Promise<string> {
  if (process.env.NODE_ENV === "test" && !executor) return "";
  try {
    const exec = executor || (await import("../proc.js")).execCommand;
    const res = await exec(
      "az",
      [
        "account",
        "get-access-token",
        "--resource",
        "499b84ac-1321-427f-aa17-267ca6975798",
        "--query",
        "accessToken",
        "-o",
        "tsv",
      ],
      { timeoutMs: 15000 },
    );
    if (res.passed && res.stdout.trim()) {
      return `Bearer ${res.stdout.trim()}`;
    }
  } catch {
    // az CLI not available or not logged in
  }
  return "";
}

export function normalizeGitRef(branch: string): string {
  const trimmed = branch.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed;
  }
  return `refs/heads/${trimmed}`;
}

function isSectionHeader(line: string): boolean {
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    line,
  );
}

function sanitizeLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function parseBulletLine(line: string): string | null {
  const match = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match?.[1] ? sanitizeLine(match[1]) : null;
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
      if (bullet) sectionLines.push(bullet);
      else if (currentLine.length > 5)
        sectionLines.push(sanitizeLine(currentLine));
    }
    return sectionLines;
  }
  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
