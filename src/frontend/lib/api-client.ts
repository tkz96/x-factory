import type {
  ConfigureGitIdentityResult,
  GitIdentity,
  GitIdentityScope,
  Project,
  Run,
  Ticket,
} from "../../shared/types.js";
import type { NormalizedError } from "../components/feedback/types.js";
import type {
  ConnectionIdentityResult,
  DescribeConnectionPayload,
  DiscoverRepositoriesPayload,
  ParseUrlResult,
  ProviderDescriptor,
  RepositoriesEnvelope,
  VerificationResult,
  VerifyCredentialsPayload,
} from "../connection/types.js";

export interface SettingsData {
  models?: {
    sessionA?: string | undefined;
    sessionB?: string | undefined;
    review?: string | undefined;
  };
  tracker?: {
    provider?: string | undefined;
    jiraHost?: string | undefined;
    jiraEmail?: string | undefined;
    azureOrgUrl?: string | undefined;
    azureProject?: string | undefined;
  };
  limits?: {
    maxRuns?: number | undefined;
    maxArtifactsMb?: number | undefined;
  };
}

export interface InspectRepositoryResponse {
  path: string;
  topLevelDir?: string | undefined;
  exists: boolean;
  isGitRepo: boolean;
  isRepositoryRoot?: boolean | undefined;
  remote?: string | undefined;
  currentBranch?: string | undefined;
  defaultBranch?: string | undefined;
  role?: string | undefined;
  /**
   * The git identity in effect for that directory (#146), resolved by the
   * server through the same git CLI the executor's worktree uses. ABSENT when
   * either user.name or user.email is unconfigured for it — never an empty
   * string and never a guessed default.
   */
  gitIdentity?: GitIdentity | undefined;
  detectedCommands: Record<string, string>;
  detectedTooling: string[];
  readiness: {
    status: "ready" | "pending_setup" | "error";
    message: string;
  };
}

export interface ReadinessData {
  ready: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    message: string;
  }>;
}

// ---------------------------------------------------------------------------
// Project creation (spec #133 §Project creation payload, #131/#145)
// ---------------------------------------------------------------------------

/** One provider connection as the creation endpoint accepts it. */
export interface ProjectCreationConnectionPayload {
  providerId: string;
  /** Every role this one connection serves (a dual-role provider appears once). */
  roles: ("tracker" | "gitHost")[];
  /** INCLUDING secret values, inline, exactly once. Never persisted client-side. */
  config: Record<string, unknown>;
}

/** One role-tagged repository, as the git-host discovery reported it. */
export interface ProjectCreationRepositoryPayload {
  id: string;
  name: string;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
  localPath?: string | undefined;
  role?: string | undefined;
  primary?: boolean | undefined;
}

/**
 * The creation payload (#131): project-level fields including the project-level
 * `gitIdentity`, a normalized `connections` array, and role-tagged
 * repositories. Consumed unchanged by `POST /api/projects`.
 */
export interface ProjectCreationPayload {
  id: string;
  name: string;
  description?: string | undefined;
  workspacePath?: string | undefined;
  gitIdentity: GitIdentity;
  connections: ProjectCreationConnectionPayload[];
  repositories: ProjectCreationRepositoryPayload[];
}

export class ApiError extends Error {
  readonly code?: string | undefined;
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    if (
      data &&
      typeof data === "object" &&
      "code" in data &&
      typeof (data as { code: unknown }).code === "string"
    ) {
      this.code = (data as { code: string }).code;
    }
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData: unknown;
    let errorMessage = `API request failed with status ${res.status}`;
    try {
      errorData = await res.json();
      if (
        errorData &&
        typeof errorData === "object" &&
        "error" in errorData &&
        typeof (errorData as { error: unknown }).error === "string"
      ) {
        errorMessage = (errorData as { error: string }).error;
      }
    } catch {
      // Body not JSON
    }
    throw new ApiError(errorMessage, res.status, errorData);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Providers (spec #133, ticket #143)
  providers: {
    async getManifest(
      role?: "tracker" | "gitHost",
    ): Promise<ProviderDescriptor[]> {
      const query = role ? `?role=${encodeURIComponent(role)}` : "";
      const res = await fetch(`/api/providers/manifest${query}`);
      return handleResponse<ProviderDescriptor[]>(res);
    },

    async verify(
      payload: VerifyCredentialsPayload,
    ): Promise<VerificationResult | NormalizedError> {
      const res = await fetch("/api/providers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return handleResponse<VerificationResult | NormalizedError>(res);
    },

    async parseUrl(url: string): Promise<ParseUrlResult> {
      const res = await fetch("/api/providers/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return handleResponse<ParseUrlResult>(res);
    },

    /**
     * Repository discovery for a git-host connection (ticket #144). Resolves to
     * the provider-agnostic envelope, or to a normalized error envelope when
     * the provider call failed; a raw provider message never arrives here.
     */
    async listRepositories(
      payload: DiscoverRepositoriesPayload,
    ): Promise<RepositoriesEnvelope | NormalizedError> {
      const res = await fetch("/api/providers/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return handleResponse<RepositoriesEnvelope | NormalizedError>(res);
    },

    /**
     * The connection's provider-owned identity (#133 story 34): one call per
     * connection CONFIGURATION, cached by its fingerprint. The server answers
     * `identity: null` for a provider without the capability and for a
     * configuration that identifies nothing, so a surface that cannot reach an
     * identity simply renders the display name.
     */
    async describe(
      payload: DescribeConnectionPayload,
    ): Promise<ConnectionIdentityResult> {
      const res = await fetch("/api/providers/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return handleResponse<ConnectionIdentityResult>(res);
    },
  },

  // Projects
  async getProjects(options?: {
    includeArchived?: boolean;
  }): Promise<Project[]> {
    const query = options?.includeArchived ? "?includeArchived=true" : "";
    const res = await fetch(`/api/projects${query}`);
    return handleResponse<Project[]>(res);
  },

  async getProject(id: string): Promise<Project> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    return handleResponse<Project>(res);
  },

  /**
   * Creates a project from the normalized connections payload (#131/#145).
   * Secrets ride THIS request once, inline in each connection's config, and the
   * response is the secret-free project record.
   */
  async createProject(payload: ProjectCreationPayload): Promise<Project> {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<Project>(res);
  },

  async inspectRepository(payload: {
    path: string;
    remote?: string | undefined;
    expectedRemote?: string | undefined;
  }): Promise<InspectRepositoryResponse> {
    const res = await fetch("/api/projects/inspect-repository", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<InspectRepositoryResponse>(res);
  },

  async configureGitIdentity(payload: {
    path: string;
    name: string;
    email: string;
    scope?: GitIdentityScope | undefined;
  }): Promise<ConfigureGitIdentityResult> {
    const res = await fetch("/api/projects/configure-git-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<ConfigureGitIdentityResult>(res);
  },

  // Tickets / Queue
  async getTickets(projectId: string): Promise<Ticket[]> {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/tickets`,
    );
    return handleResponse<Ticket[]>(res);
  },

  // Runs
  async getRuns(): Promise<Run[]> {
    const res = await fetch("/api/runs");
    return handleResponse<Run[]>(res);
  },

  async getRun(runId: string): Promise<Run> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    return handleResponse<Run>(res);
  },

  async createRun(payload: {
    projectId: string;
    ticketId?: string | undefined;
    ticketTitle?: string | undefined;
    plan?: string | undefined;
    acceptanceCriteria?: string[] | string | undefined;
    description?: string | undefined;
    branch?: string | undefined;
  }): Promise<Run> {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<Run>(res);
  },

  async resumeRun(runId: string): Promise<{ ok: boolean; run: Run }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
      method: "POST",
    });
    return handleResponse<{ ok: boolean; run: Run }>(res);
  },

  async abandonRun(
    runId: string,
    reason?: string,
  ): Promise<{ ok: boolean; run: Run }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/abandon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return handleResponse<{ ok: boolean; run: Run }>(res);
  },

  async steerRun(
    runId: string,
    message: string,
  ): Promise<{ ok: boolean; runId: string }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return handleResponse<{ ok: boolean; runId: string }>(res);
  },

  async chatWithRun(
    runId: string,
    message: string,
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return handleResponse<{ ok: boolean; message: string }>(res);
  },

  async transitionRun(
    runId: string,
    action: "approve" | "restart" | "abort" | "requeue",
    payload?: unknown,
  ): Promise<{ ok: boolean; run: Run }> {
    const res = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/transitions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      },
    );
    return handleResponse<{ ok: boolean; run: Run }>(res);
  },

  async stopRun(runId: string): Promise<{ ok: boolean; run: Run }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
    });
    return handleResponse<{ ok: boolean; run: Run }>(res);
  },

  async prRun(
    runId: string,
  ): Promise<{ ok: boolean; prUrl?: string; message?: string }> {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/pr`, {
      method: "POST",
    });
    return handleResponse<{ ok: boolean; prUrl?: string; message?: string }>(
      res,
    );
  },

  async testScopes(payload: {
    projectId?: string | undefined;
    providerId?: string | undefined;
    organization?: string | undefined;
    project?: string | undefined;
    pat?: string | undefined;
    [key: string]: unknown;
  }): Promise<{
    ok: boolean;
    overPrivileged?: boolean | undefined;
    scopes?: Record<string, unknown> | undefined;
    errors?: string[] | undefined;
    warnings?: string[] | undefined;
    error?: string | undefined;
  }> {
    const res = await fetch("/api/projects/test-scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<{
      ok: boolean;
      overPrivileged?: boolean | undefined;
      scopes?: Record<string, unknown> | undefined;
      errors?: string[] | undefined;
      warnings?: string[] | undefined;
      error?: string | undefined;
    }>(res);
  },

  /**
   * @deprecated Use `testScopes` instead. Retained for backwards compatibility.
   */
  async testAzureScopes(payload: {
    projectId?: string | undefined;
    organization?: string | undefined;
    project?: string | undefined;
    pat?: string | undefined;
    [key: string]: unknown;
  }) {
    return this.testScopes(payload);
  },

  // Settings & Readiness
  async getSettings(): Promise<SettingsData> {
    const res = await fetch("/api/settings");
    return handleResponse<SettingsData>(res);
  },

  async saveSettings(payload: Partial<SettingsData>): Promise<{ ok: boolean }> {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<{ ok: boolean }>(res);
  },

  async getReadiness(): Promise<ReadinessData> {
    const res = await fetch("/api/readiness");
    return handleResponse<ReadinessData>(res);
  },

  async getDiagnostics(): Promise<DiagnosticsData> {
    const res = await fetch("/api/diagnostics");
    return handleResponse<DiagnosticsData>(res);
  },

  async getDocsCatalog(): Promise<DocsCatalogResponse> {
    const res = await fetch("/api/docs");
    return handleResponse<DocsCatalogResponse>(res);
  },

  async searchDocs(query: string): Promise<DocsSearchResponse> {
    const res = await fetch(`/api/docs/search?q=${encodeURIComponent(query)}`);
    return handleResponse<DocsSearchResponse>(res);
  },

  async getDoc(category: string, slug: string): Promise<DocDetailResponse> {
    const res = await fetch(
      `/api/docs/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
    );
    return handleResponse<DocDetailResponse>(res);
  },
};

export interface DocSearchMatch {
  heading: string;
  headingId: string;
  snippet: string;
  matchCount: number;
}

export interface DocSearchResult {
  category: string;
  categoryName: string;
  slug: string;
  title: string;
  totalMatches: number;
  sections: DocSearchMatch[];
}

export interface DocsSearchResponse {
  query: string;
  totalMatches: number;
  results: DocSearchResult[];
}

export interface DocItem {
  slug: string;
  title: string;
  description: string;
  path: string;
}

export interface DocCategory {
  id: string;
  name: string;
  description: string;
  docs: DocItem[];
}

export interface DocsCatalogResponse {
  categories: DocCategory[];
}

export interface DocDetailResponse {
  category: string;
  slug: string;
  title: string;
  description: string;
  markdown: string;
}

export interface DiagnosticsData {
  status: string;
  system: {
    uptime: number;
    nodeVersion: string;
    memory: Record<string, number>;
  };
  database: {
    status: string;
    version: number;
    runs: { total: number; active: number };
    jobs: {
      total: number;
      pending: number;
      claimed: number;
      completed: number;
      failed: number;
      stale: number;
    };
  };
  worker: {
    status: string;
    activeCount: number;
    fleet: Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }>;
  };
  timestamp: string;
}
