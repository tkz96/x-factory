// src/frontend/lib/api-client.ts — Typed REST API client for backend communication.

import type { Project, Run, Ticket } from "../../shared/types.js";

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

export interface ReadinessData {
  ready: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    message: string;
  }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
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
  // Projects
  async getProjects(): Promise<Project[]> {
    const res = await fetch("/api/projects");
    return handleResponse<Project[]>(res);
  },

  async getProject(id: string): Promise<Project> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    return handleResponse<Project>(res);
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

  async testAzureScopes(payload: {
    projectId?: string;
    organization?: string;
    project?: string;
    pat?: string;
  }): Promise<{
    ok: boolean;
    overPrivileged?: boolean;
    scopes?: Record<string, unknown>;
    error?: string;
  }> {
    const res = await fetch("/api/projects/test-azure-scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<{
      ok: boolean;
      overPrivileged?: boolean;
      scopes?: Record<string, unknown>;
      error?: string;
    }>(res);
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
};

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
