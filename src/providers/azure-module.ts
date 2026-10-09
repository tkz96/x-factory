// src/providers/azure-module.ts — Azure DevOps provider implementation.
//
// Wayfinder #127 / Ticket #139:
// - Provider-conformant module satisfying Provider<"azure"> contract
// - Zod configSchema with envKey secret metadata (passes serializer gate)
// - Defect H2 fix: organization vs orgUrl mismatch detection
// - Internal auth acquisition (PAT Basic, JWT Bearer, Azure CLI fallback)
// - HTML-on-2xx normalization (auth wall detection)
// - CAPABILITY_UNCONFIRMED degraded verification probes
// - REST-primary PR creation conforming to the create-only invariant
// - parseQuickUrl pre-fills both tracker and git-host drafts

import { z } from "zod/v4";
import {
  identityField,
  joinIdentityParts,
  schemeStripped,
} from "./connection-identity.js";
import {
  type CreatePullRequestInput,
  type FindPullRequestInput,
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
import {
  type HttpTransport,
  isHtmlResponse,
  isLoginRedirect,
  ProviderHttpError,
  providerFetch,
} from "./http.js";
import { migrateLegacyProviderConfig } from "./legacy-migration.js";

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
  pat: z.string().optional().meta({
    label: "Personal Access Token",
    uiType: "secret",
    secret: true,
    envKey: "AZURE_DEVOPS_PAT",
    placeholder: "••••••••",
    help: "Personal Access Token with required scopes: Code (Read & Write) and Work Items (Read & Write) (optional if authenticated via Azure CLI).",
  }),
});

export type AzureConfig = z.infer<typeof azureConfigSchema>;

// ---------------------------------------------------------------------------
// Connection identity (describeConnection, spec #133 story 34)
// ---------------------------------------------------------------------------

/**
 * The organization as Azure DevOps itself names it, taken from `orgUrl`:
 *
 *   - `https://dev.azure.com/acme`      → `acme`  (the first path segment)
 *   - `https://acme.visualstudio.com`   → `acme`  (the host label)
 *   - anything else                     → the value with its scheme stripped
 *                                         (`https://azure.example/org` →
 *                                         `azure.example/org`)
 *
 * The first two are the forms Azure DevOps actually serves; the third keeps a
 * self-hosted or proxied URL readable without inventing a label for it.
 */
function organizationFromOrgUrl(orgUrl: string): string | null {
  const stripped = schemeStripped(orgUrl);
  if (stripped === null) {
    return null;
  }

  const [host, ...pathSegments] = stripped.split("/");
  if (host === "dev.azure.com") {
    const organization = pathSegments.find((segment) => segment !== "");
    return organization ?? null;
  }

  const legacy = /^([a-zA-Z0-9-]+)\.visualstudio\.com$/.exec(host ?? "");
  return legacy?.[1] ?? stripped;
}

/**
 * The connection's identity as a human reads it (#133 story 34):
 * `"organization/MyProject"`. `orgUrl` and `project` are the provider's two
 * identity fields, and whichever one is recorded is used on its own when the
 * other is missing — `null` when neither is.
 *
 * The PAT is NEVER read: an identity is presentation metadata that may be
 * rendered on any surface, while the PAT is a credential.
 */
export function describeAzureConnection(config: ProviderConfig): string | null {
  const orgUrl = identityField(config.orgUrl);
  return joinIdentityParts(
    [
      orgUrl === null ? null : organizationFromOrgUrl(orgUrl),
      identityField(config.project),
    ],
    "/",
  );
}

/**
 * Provider-internal API error class preserving HTTP status, headers, and classification.
 * The raw error never crosses the provider/API boundary — translated via toUserError.
 */
export class AzureApiError extends ProviderHttpError {
  constructor(
    message: string,
    options?: {
      status?: number | undefined;
      headers?: Headers | undefined;
      isHtml?: boolean | undefined;
      isRateLimit?: boolean | undefined;
      retryAfterMs?: number | undefined;
      bodyText?: string | undefined;
      data?: unknown | undefined;
      isTimeout?: boolean | undefined;
      cause?: unknown;
    },
  ) {
    super(message, {
      status: options?.status ?? 0,
      isTimeout: options?.isTimeout,
      cause: options?.cause,
      headers: options?.headers,
      isHtml: options?.isHtml,
      isRateLimit: options?.isRateLimit,
      retryAfterMs: options?.retryAfterMs,
      bodyText: options?.bodyText,
      data: options?.data,
    });
    this.name = "AzureApiError";
  }
}

export { extractOrgNameFromUrl } from "./azure-urls.js";

/**
 * Defect H2 fix: Detect organization vs orgUrl configuration mismatch.
 *
 * Delegates to the unified legacy migration step (#186), ensuring conflicting
 * configurations are NEVER silently conflated.
 */
export function detectOrganizationMismatch(config: Record<string, unknown>): {
  mismatch: boolean;
  error?: string;
} {
  try {
    migrateLegacyProviderConfig("azure", config);
    return { mismatch: false };
  } catch (err) {
    return { mismatch: true, error: (err as Error).message };
  }
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
export { isHtmlResponse } from "./http.js";

export interface AzureFetchOptions extends RequestInit {
  fetchFn?: typeof fetch | HttpTransport | undefined;
  timeoutMs?: number | undefined;
}

/**
 * True for a sign-in challenge: an HTML page on a non-error status (2xx/3xx).
 * An HTML error page (4xx/5xx) classifies by its status code instead.
 * With `orUnauthorized`, a plain 401 counts too.
 */
function isAzureSignInError(
  err: AzureApiError,
  orUnauthorized = false,
): boolean {
  if (orUnauthorized && err.status === 401) return true;
  return Boolean(err.isHtml) && err.status < 400;
}

/**
 * HTTP helper normalizing HTML on 2xx and Azure API errors into AzureApiError.
 */
export async function azureFetch(
  url: string,
  options: AzureFetchOptions = {},
): Promise<{ status: number; text: string; data: unknown; headers: Headers }> {
  const res = await providerFetch(url, {
    ...options,
    isRateLimited: (status, _headers, text) =>
      status === 429 || text.includes("TF400733"),
    isSignInRedirect: (r, text) =>
      r.status === 203 ||
      isLoginRedirect(r) ||
      (r.status >= 200 &&
        r.status < 300 &&
        isHtmlResponse(r.headers.get("content-type"), text)),
    errorFactory: (msg, opts) => new AzureApiError(msg, opts),
  });

  return {
    status: res.status,
    text: res.text,
    data: res.data,
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
  if (status === 401 || status === 203 || (isHtml && (status ?? 0) < 400)) {
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
  if (status !== undefined && status > 0) {
    return { code: "UNKNOWN", context };
  }

  // 2. Message Heuristics Fallback (strictly for status-less errors)
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
    /\b(?:token|sign-in|unauthorized)\b/i.test(lowerMsg) ||
    lowerMsg.includes("html response") ||
    /\bpat\b/i.test(lowerMsg) ||
    /\bauth\b/i.test(lowerMsg)
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
  fetchFn?: typeof fetch | HttpTransport | undefined;
  executor?: CliCommandExecutor | undefined;
  probeTimeoutMs?: number | undefined;
}

export interface ResolvedAzureContext {
  readonly orgUrl: string;
  readonly project: string;
  readonly cleanOrgUrl: string;
  readonly encodedProject: string;
  readonly authHeader: string;
}

export async function prepareAzureContext(
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

export interface ProbeRepositoryResult {
  readonly confirmed: boolean;
  readonly repos: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly warning?: VerificationWarning | undefined;
}

export async function probeRepositoriesCapability(
  context: ResolvedAzureContext,
  fetchFn: typeof fetch | HttpTransport = globalThis.fetch,
): Promise<ProbeRepositoryResult> {
  const reposUrl = `${context.cleanOrgUrl}/${context.encodedProject}/_apis/git/repositories?api-version=7.1`;
  try {
    const reposRes = await azureFetch(reposUrl, {
      headers: {
        Authorization: context.authHeader,
        Accept: "application/json",
      },
      fetchFn,
      signal: AbortSignal.timeout(5000),
    });

    const reposPayload = reposRes.data as
      | { value?: unknown[] }
      | null
      | undefined;
    const repos = Array.isArray(reposPayload?.value)
      ? reposPayload.value.map((r: unknown) => {
          const item = (r && typeof r === "object" ? r : {}) as Record<
            string,
            unknown
          >;
          return {
            id: String(item.id ?? ""),
            name: String(item.name ?? ""),
          };
        })
      : [];

    return { confirmed: true, repos };
  } catch (err) {
    if (err instanceof AzureApiError && isAzureSignInError(err, true)) {
      throw err;
    }
    return {
      confirmed: false,
      repos: [],
      warning: {
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listRepositories",
      },
    };
  }
}

export interface ProbeTicketResult {
  readonly confirmed: boolean;
  readonly warning?: VerificationWarning | undefined;
}

export async function probeTicketsCapability(
  context: ResolvedAzureContext,
  fetchFn: typeof fetch | HttpTransport = globalThis.fetch,
): Promise<ProbeTicketResult> {
  const wiqlUrl = `${context.cleanOrgUrl}/${context.encodedProject}/_apis/wit/wiql?api-version=7.1`;
  try {
    const wiqlRes = await azureFetch(wiqlUrl, {
      method: "POST",
      headers: {
        Authorization: context.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id] DESC",
      }),
      fetchFn,
      signal: AbortSignal.timeout(5000),
    });

    return { confirmed: wiqlRes.status === 200 };
  } catch (err) {
    if (err instanceof AzureApiError && isAzureSignInError(err, true)) {
      throw err;
    }
    return {
      confirmed: false,
      warning: {
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listTickets",
      },
    };
  }
}

export function composeVerificationResult(
  warnings: readonly VerificationWarning[],
): VerificationResult {
  return warnings.length > 0
    ? { status: "degraded", warnings: [...warnings] }
    : { status: "ok", warnings: [] };
}

/**
 * Creates an Azure DevOps Provider instance with optional injected dependencies.
 */
export function createAzureProvider(
  deps: AzureProviderDependencies = {},
): Provider<"azure"> {
  const getFetcher = () => deps.fetchFn ?? globalThis.fetch;
  const executor = deps.executor;
  const probeTimeout = deps.probeTimeoutMs ?? 5000;

  return {
    id: "azure",
    displayName: "Azure DevOps",
    roles: ["tracker", "gitHost"] as const,
    iconRef: "provider-azure",
    configSchema: azureConfigSchema,

    toUserError,

    describeConnection(config: ProviderConfig): string | null {
      return describeAzureConnection(config);
    },

    async verifyCredentials(
      config: ProviderConfig,
    ): Promise<VerificationResult> {
      // Schema validation: adapters do not search nested keys
      const parsed = azureConfigSchema.safeParse(config);
      if (!parsed.success) {
        throw new Error(`Invalid Azure configuration: ${parsed.error.message}`);
      }

      // 1. Defect H2 fix: Detect organization vs orgUrl mismatch
      const mismatch = detectOrganizationMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      // 2. Context resolution and authentication
      const context = await prepareAzureContext(config, executor);
      const warnings: VerificationWarning[] = [];

      // 3. Repository read capability probe
      const repoResult = await probeRepositoriesCapability(
        context,
        getFetcher(),
      );
      if (repoResult.warning) {
        warnings.push(repoResult.warning);
      }

      // 4. Ticket read capability probe
      const ticketResult = await probeTicketsCapability(context, getFetcher());
      if (ticketResult.warning) {
        warnings.push(ticketResult.warning);
      }

      // 5. Pull request creation is a write mutation and cannot be safely verified in read-only verification
      warnings.push({
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "createPullRequest",
      });

      return composeVerificationResult(warnings);
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
        const res = await azureFetch(wiqlUrl, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project`,
          }),
          fetchFn: getFetcher(),
          signal: AbortSignal.timeout(probeTimeout),
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
      } catch (err) {
        if (
          err instanceof AzureApiError &&
          err.status === 403 &&
          !err.isRateLimit &&
          !isAzureSignInError(err)
        ) {
          findings.push({ capability: "listTickets", status: "missing" });
        } else {
          findings.push({ capability: "listTickets", status: "unconfirmed" });
        }
      }

      // 2. Repositories read probe
      try {
        const reposUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
        const res = await azureFetch(reposUrl, {
          headers: { Authorization: authHeader, Accept: "application/json" },
          fetchFn: getFetcher(),
          signal: AbortSignal.timeout(probeTimeout),
        });
        if (res.status === 200) {
          findings.push({
            capability: "listRepositories",
            status: "confirmed",
          });
        } else {
          findings.push({
            capability: "listRepositories",
            status: res.status === 403 ? "missing" : "unconfirmed",
          });
        }
      } catch (err) {
        if (
          err instanceof AzureApiError &&
          err.status === 403 &&
          !err.isRateLimit &&
          !isAzureSignInError(err)
        ) {
          findings.push({ capability: "listRepositories", status: "missing" });
        } else {
          findings.push({
            capability: "listRepositories",
            status: "unconfirmed",
          });
        }
      }

      // 3. Pull request write capability cannot be safely verified via mutation probe
      findings.push({
        capability: "createPullRequest",
        status: "unconfirmed",
      });

      // 4. Overprivilege checks: recycle bin (Code: Full / admin access)
      try {
        const binUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/recycleBin/repositories?api-version=7.1`;
        const res = await azureFetch(binUrl, {
          headers: { Authorization: authHeader, Accept: "application/json" },
          fetchFn: getFetcher(),
          signal: AbortSignal.timeout(probeTimeout),
        });
        if (res.status === 200) {
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
          executor,
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
      { timeoutMs: 15000, envPolicy: "inherit" },
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
