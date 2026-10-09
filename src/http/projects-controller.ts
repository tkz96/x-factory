// src/http/projects-controller.ts — Multi-repository project CRUD, onboarding, tracker secrets, and migration endpoints.

import { stat } from "node:fs/promises";
import path from "node:path";
import type { ApiContext, Repositories } from "../composition-root.js";
import {
  createProject,
  deleteProject,
  getProject,
  loadProjects,
  saveProject,
} from "../config.js";
import { isConnectionsProjectInput } from "../config-schema.js";
import {
  checkProjectReadiness,
  configureGitIdentity,
  evaluateRepositoryReadiness,
  inspectLocalRepository,
} from "../inspection/index.js";
import { expandUserPath, scanGitSubdirectories } from "../paths.js";
import { loadProjectEnv, saveProjectEnv } from "../project-env.js";
import {
  hasCapability,
  type Provider,
  type ProviderConfig,
  REQUIRED_WORKFLOW_LABEL,
} from "../providers/contract.js";
import {
  buildProjectMigrationPlan,
  extractTrackerCredentialsToSave,
  type ProjectMigrationInput,
  resolveProjectTrackerSummary,
  testProjectTrackerConnection,
} from "../providers/project-config.js";
import {
  findConnectionForRole,
  resolveProjectConnection,
} from "../providers/project-connections.js";
import { redactConfigForProvider } from "../providers/redaction.js";
import {
  getProvider,
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import type { ProjectWriteStore } from "../services/connection-write-plan.js";
import {
  assertLegacyTrackerUsable,
  createProjectFromConnections,
  updateProjectConnectionsById,
} from "../services/project-creation.js";
import { TERMINAL_RUN_STATUSES } from "../shared/run-status-policy.js";
import {
  catchHttpErrors,
  errorResponse,
  jsonResponse,
  parseJsonBody,
  validateAgainstSchema,
  withJsonBody,
  withValidatedBody,
} from "./responses.js";
import {
  ConfigureGitIdentityBodySchema,
  SaveProjectBodySchema,
  UpdateProjectConnectionsBodySchema,
} from "./schemas.js";

async function handleGetProjects(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const projects = await loadProjects();
  const filtered = includeArchived
    ? projects
    : projects.filter((p) => !p.archived);
  return jsonResponse(filtered);
}

async function handleCreateProject(
  req: Request,
  registry: ProviderRegistry,
  store?: ProjectWriteStore | undefined,
): Promise<Response> {
  return withValidatedBody(
    req,
    SaveProjectBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        // The validated union's own discrimination decides the path (#131):
        // a payload that satisfies the normalized connections branch creates
        // through it; everything else keeps the legacy configuration path.
        if (isConnectionsProjectInput(body)) {
          return jsonResponse(
            await createProjectFromConnections(body, { registry, store }),
            201,
          );
        }
        // The legacy path is gated BEFORE its write (#133 correction 1): a
        // legacy record's git host IS its repository, so the connection-array
        // form of the role rule does not apply to it — but a project whose
        // tracker names nothing the registry can serve must not be created in
        // the first place, on either branch.
        assertLegacyTrackerUsable(body.issueTracker, registry);
        return jsonResponse(await createProject(body), 201);
      }),
    "Invalid JSON for project creation.",
  );
}

async function handleGetProject(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const readiness = await checkProjectReadiness(project);
  return jsonResponse({ ...project, readiness });
}

function hasOwnConnections(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Object.hasOwn(body, "connections")
  );
}

async function handleUpdateProject(
  projectId: string,
  req: Request,
  registry: ProviderRegistry,
  store?: ProjectWriteStore | undefined,
): Promise<Response> {
  const raw = await parseJsonBody(req);
  if (!raw) {
    return errorResponse("Invalid JSON for project update.", 400);
  }

  if (hasOwnConnections(raw)) {
    const validated = validateAgainstSchema(
      raw,
      UpdateProjectConnectionsBodySchema,
    );

    if (!validated.ok) {
      return validated.response;
    }

    return catchHttpErrors(async () => {
      const saved = await updateProjectConnectionsById(
        projectId,
        validated.data,
        { registry, store },
      );
      return jsonResponse(saved);
    });
  }

  const project = await getProject(projectId);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found.`, 404);
  }

  return catchHttpErrors(async () => {
    const merged = {
      ...project,
      ...raw,
      id: projectId,
    };

    const saved = await saveProject(merged);
    return jsonResponse(saved);
  });
}

async function handleDeleteProject(projectId: string): Promise<Response> {
  return catchHttpErrors(async () => {
    await deleteProject(projectId);
    return jsonResponse({ ok: true });
  });
}

/**
 * POST /api/projects/discover-repositories (legacy wire endpoint)
 * Retained for backward compatibility; delegates to the provider registry.
 * Canonical discovery is POST /api/providers/repositories (via api.providers.listRepositories).
 */
async function handleDiscoverRepositories(
  req: Request,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  return withJsonBody<Record<string, unknown>>(
    req,
    (body) =>
      catchHttpErrors(async () => {
        const providerId = body.provider as string | undefined;
        if (!providerId) {
          return errorResponse(
            "Provider is required for repository discovery.",
            400,
          );
        }
        const provider = getProvider(providerId, registry);
        if (!provider || !hasCapability(provider, "listRepositories")) {
          return errorResponse(
            `Unsupported discovery provider: ${providerId}`,
            400,
          );
        }
        const repos = await provider.listRepositories(body as ProviderConfig);
        return jsonResponse({
          provider: providerId,
          repositories: repos,
        });
      }),
    "Invalid JSON for repository discovery.",
  );
}

async function handleInspectRepository(req: Request): Promise<Response> {
  return withJsonBody<{
    path?: string;
    remote?: string;
    expectedRemote?: string;
  }>(
    req,
    async ({ path: repoPath, remote, expectedRemote }) => {
      if (!repoPath || typeof repoPath !== "string") {
        return errorResponse("Repository path is required.");
      }
      const expandedPath = expandUserPath(repoPath);
      const targetRemote = remote || expectedRemote;
      return catchHttpErrors(async () => {
        const result = await inspectLocalRepository(expandedPath, targetRemote);
        const readiness = await evaluateRepositoryReadiness({
          id: "repo",
          name: path.basename(expandedPath),
          path: expandedPath,
          remote: targetRemote,
          defaultBranch: result.defaultBranch || "main",
        });
        return jsonResponse({
          ...result,
          readiness: {
            status: readiness.status,
            message: readiness.message,
          },
        });
      });
    },
    "Invalid JSON for repository inspection.",
  );
}

async function handleConfigureGitIdentity(req: Request): Promise<Response> {
  return withValidatedBody(
    req,
    ConfigureGitIdentityBodySchema,
    async ({ path: repoPath, name, email, scope }) => {
      const expandedPath = expandUserPath(repoPath);
      return catchHttpErrors(async () => {
        const result = await configureGitIdentity({
          path: expandedPath,
          name,
          email,
          scope,
        });
        return jsonResponse(result);
      });
    },
    "Invalid JSON for git identity configuration.",
  );
}

async function handleGetProjectReadiness(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const readiness = await checkProjectReadiness(project);
  return jsonResponse(readiness);
}

async function handleGetProjectTickets(
  projectId: string,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  if (project.archived) {
    return errorResponse(
      `Project "${projectId}" is archived. Ticket fetching is disabled.`,
      400,
    );
  }
  const env = await loadProjectEnv(projectId);
  const connection = resolveProjectConnection(
    project,
    "tracker",
    env,
    registry,
  );
  if (!connection) {
    return errorResponse(
      `Project "${projectId}" has no issue tracker configured.`,
      400,
    );
  }
  const { provider, config } = connection;
  if (!hasCapability(provider, "listTickets")) {
    return errorResponse(
      `Unsupported issue tracker provider: "${provider.id}".`,
      400,
    );
  }
  const requiredLabel =
    (config.requiredLabel as string | undefined) || REQUIRED_WORKFLOW_LABEL;

  const tickets = await provider.listTickets(config, { requiredLabel });
  return jsonResponse(tickets);
}

async function handleGetProjectTracker(
  projectId: string,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const env = await loadProjectEnv(projectId);
  const summary = resolveProjectTrackerSummary(project, env, registry);
  // Redaction before serialization: the tracker config is provider config.
  return jsonResponse({
    ...summary,
    config: redactConfigForProvider(
      registry.get(summary.provider),
      summary.config,
    ),
  });
}

async function handleUpdateProjectTrackerCredentials(
  projectId: string,
  req: Request,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  return withJsonBody<Record<string, string>>(
    req,
    async (body) => {
      const connection = findConnectionForRole(project, "tracker", registry);
      if (!connection) {
        return errorResponse("Missing issue tracker provider.", 400);
      }
      const provider = registry.get(connection.providerId);
      if (!provider) {
        return errorResponse(
          `Issue tracker provider "${connection.providerId}" is not registered; no credentials were saved.`,
          400,
        );
      }
      const varsToSave = extractTrackerCredentialsToSave(body, provider);
      await saveProjectEnv(projectId, varsToSave);
      return jsonResponse({ ok: true, message: "Credentials updated." });
    },
    "Invalid JSON for tracker credentials.",
  );
}

async function handleTestProjectTracker(
  projectId: string,
  req: Request,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  const processRequest = async (bodyData: Record<string, unknown>) => {
    const provider =
      (bodyData.provider as string | undefined) ||
      findConnectionForRole(project, "tracker", registry)?.providerId;
    if (!provider) {
      return errorResponse("Missing issue tracker provider.", 400);
    }
    const env = await loadProjectEnv(projectId);

    const result = await testProjectTrackerConnection(
      provider,
      project,
      env,
      bodyData,
      project.repositoryPath,
      registry,
    );
    return jsonResponse(result);
  };

  if (!req.body) {
    return processRequest({});
  }

  return withJsonBody(req, processRequest, "Invalid JSON for tracker test.");
}

async function handleMigrateProject(
  projectId: string,
  req: Request,
  registry: ProviderRegistry,
  repos: Repositories,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  if (project.archived) {
    return errorResponse(`Project "${projectId}" is already archived.`, 400);
  }

  // Active run guard
  const runs = repos.runs.list();
  const activeRun = runs.find(
    (r) => r.project.id === projectId && !TERMINAL_RUN_STATUSES.has(r.status),
  );
  if (activeRun) {
    return errorResponse(
      "Cannot migrate project while active runs are executing. Please wait for them to finish or stop them manually.",
      409,
    );
  }

  return withJsonBody<ProjectMigrationInput>(
    req,
    async (body) => {
      if (!body.targetProvider) {
        return errorResponse("targetProvider is required.", 400);
      }

      const { newId, newProject, archivedOldProject, secretsToSave } =
        buildProjectMigrationPlan(
          project,
          body,
          registry,
          await loadProjectEnv(projectId),
        );

      await saveProject(archivedOldProject);
      const savedNewProject = await saveProject(newProject);

      if (Object.keys(secretsToSave).length > 0) {
        await saveProjectEnv(newId, secretsToSave);
      }

      return jsonResponse(
        {
          ok: true,
          archivedProjectId: project.id,
          predecessorId: project.id,
          newProjectId: newId,
          project: savedNewProject,
          migratedProject: savedNewProject,
        },
        201,
      );
    },
    "Invalid JSON for project migration.",
  );
}

async function handleProjectMemberCrud(
  method: string,
  id: string,
  req: Request,
  registry: ProviderRegistry,
  store?: ProjectWriteStore | undefined,
): Promise<Response | null> {
  switch (method) {
    case "GET":
      return handleGetProject(id);
    case "PATCH":
    case "PUT":
      return handleUpdateProject(id, req, registry, store);
    case "DELETE":
      return handleDeleteProject(id);
    default:
      return null;
  }
}

async function handleProjectMemberRoute(
  method: string,
  id: string,
  action: string | undefined,
  subaction: string | undefined,
  partsCount: number,
  req: Request,
  registry: ProviderRegistry,
  store?: ProjectWriteStore | undefined,
): Promise<Response | null> {
  if (action === "tickets" && method === "GET") {
    return handleGetProjectTickets(id, registry);
  }
  if (action === "readiness" && method === "GET") {
    return handleGetProjectReadiness(id);
  }
  if (action === "tracker") {
    if (!subaction && method === "GET") {
      return handleGetProjectTracker(id, registry);
    }
    if (
      subaction === "credentials" &&
      (method === "PUT" || method === "POST")
    ) {
      return handleUpdateProjectTrackerCredentials(id, req, registry);
    }
    if (subaction === "test" && method === "POST") {
      return handleTestProjectTracker(id, req, registry);
    }
  }
  if (!action && partsCount === 2) {
    return handleProjectMemberCrud(method, id, req, registry, store);
  }
  return null;
}

async function handleCheckPath(req: Request): Promise<Response> {
  return withJsonBody<{ path?: string }>(
    req,
    async ({ path: rawPath }) => {
      const inputPath = typeof rawPath === "string" ? rawPath.trim() : "";
      if (!inputPath) return errorResponse("Path is required.");

      const expanded = expandUserPath(inputPath);
      try {
        const s = await stat(expanded);
        if (!s.isDirectory()) {
          return jsonResponse({
            exists: false,
            existsLocally: false,
            resolvedPath: expanded,
            isDirectory: false,
            error: "Path is not a directory.",
          });
        }
        const gitRepos = await scanGitSubdirectories(expanded);
        return jsonResponse({
          exists: true,
          existsLocally: true,
          resolvedPath: expanded,
          isDirectory: true,
          gitRepos,
          gitRepoCount: gitRepos.length,
        });
      } catch {
        return jsonResponse({
          exists: false,
          existsLocally: false,
          resolvedPath: expanded,
          error: "Directory does not exist.",
        });
      }
    },
    "Invalid JSON for path check.",
  );
}

async function handleTestConnection(req: Request): Promise<Response> {
  return withJsonBody<Record<string, unknown>>(
    req,
    async (data) => {
      const rawProvider = data.provider;
      if (typeof rawProvider !== "string" || !rawProvider.trim()) {
        return errorResponse(
          "Provider is required for connection testing.",
          400,
        );
      }
      const providerId = rawProvider.trim();
      const provider = getProvider(providerId);
      if (!provider) {
        return jsonResponse({
          ok: false,
          error: `Unknown provider "${providerId}".`,
        });
      }

      try {
        const verifyResult = await provider.verifyCredentials(
          data as ProviderConfig,
        );
        const ok =
          verifyResult.status === "ok" || verifyResult.status === "degraded";

        if (data.validateScopes || data.pat) {
          if (hasCapability(provider, "verifyScopes")) {
            const scopeResult = await provider.verifyScopes(
              data as ProviderConfig,
            );
            const scopeErrors: string[] = [];
            const scopeWarnings: string[] = [];
            const scopes: Record<string, boolean> = {};

            for (const f of scopeResult.findings) {
              scopes[f.capability] = f.status === "confirmed";
              if (f.status === "missing") {
                scopeErrors.push(`Missing capability: ${f.capability}`);
              }
            }

            return jsonResponse({
              ok: ok && scopeErrors.length === 0,
              status: verifyResult.status,
              scopes,
              overPrivileged: scopeResult.overPrivileged,
              scopeErrors,
              scopeWarnings,
              warnings: scopeWarnings,
              error: !ok
                ? "Credential verification failed."
                : scopeErrors.length > 0
                  ? `Scope verification failed: ${scopeErrors.join(" ")}`
                  : undefined,
            });
          }
        }

        return jsonResponse({
          ok,
          status: verifyResult.status,
          message: `${provider.displayName} connection successful.`,
        });
      } catch (err: unknown) {
        return jsonResponse({
          ok: false,
          error: (err as Error).message,
        });
      }
    },
    "Invalid JSON for connection test.",
  );
}

/**
 * Resolves the provider a scope diagnostic runs against WITHOUT naming one
 * (#141): the request may name an explicit `providerId`, otherwise the
 * project's own tracker connection decides. `undefined` means nothing could be
 * resolved — the caller reports that instead of guessing a provider.
 */
async function resolveScopeDiagnosticProvider(
  data: Record<string, unknown>,
  registry: ProviderRegistry,
): Promise<Provider | undefined> {
  const requested = data.providerId;
  if (typeof requested === "string" && requested.trim()) {
    return getProvider(requested.trim(), registry);
  }
  const projectId = data.projectId;
  if (typeof projectId !== "string" || !projectId.trim()) return undefined;
  const project = await getProject(projectId.trim());
  if (!project) return undefined;
  const recorded = findConnectionForRole(project, "tracker", registry);
  return recorded ? getProvider(recorded.providerId, registry) : undefined;
}

/**
 * Why a scope diagnostic resolved no provider — accurate for the request that
 * was actually sent. A body that named an UNREGISTERED provider is not told to
 * "pass an explicit providerId": it did, and that id is the problem.
 */
function scopeResolutionError(data: Record<string, unknown>): string {
  const requested = data.providerId;
  if (typeof requested === "string" && requested.trim()) {
    return `No tracker connection resolved for scope verification: no provider "${requested.trim()}" is registered.`;
  }
  return "No tracker connection resolved for scope verification: pass a projectId with a registered tracker connection, or an explicit providerId.";
}

async function handleTestProviderScopes(
  req: Request,
  registry: ProviderRegistry,
): Promise<Response> {
  return withJsonBody<Record<string, unknown>>(
    req,
    async (data) => {
      const provider = await resolveScopeDiagnosticProvider(data, registry);
      if (!provider) {
        return jsonResponse({
          ok: false,
          scopes: {},
          errors: [scopeResolutionError(data)],
        });
      }
      if (!hasCapability(provider, "verifyScopes")) {
        return jsonResponse({
          ok: false,
          scopes: {},
          errors: [
            "The resolved tracker provider does not support scope verification.",
          ],
        });
      }
      try {
        const report = await provider.verifyScopes(data as ProviderConfig);
        const errors: string[] = [];
        const warnings: string[] = [];
        const scopes: Record<string, boolean> = {};

        for (const finding of report.findings) {
          scopes[finding.capability] = finding.status === "confirmed";
          if (finding.status === "missing") {
            errors.push(`Missing scope for ${finding.capability}`);
          } else if (finding.status === "unconfirmed") {
            warnings.push(`Unconfirmed capability: ${finding.capability}`);
          }
        }

        const ok = errors.length === 0;
        return jsonResponse({
          ok,
          overPrivileged: report.overPrivileged,
          scopes,
          errors,
          warnings,
        });
      } catch (err: unknown) {
        return jsonResponse({
          ok: false,
          overPrivileged: false,
          scopes: {},
          errors: [(err as Error).message],
          warnings: [],
        });
      }
    },
    "Invalid JSON for scope verification.",
  );
}

export async function handleProjectsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  subactionOrPartsCount: string | number | undefined,
  partsCountOrReq: number | Request,
  maybeReq?: Request,
  ctx?: ApiContext,
): Promise<Response | null> {
  let subaction: string | undefined;
  let partsCount: number;
  let req: Request;
  const registry = ctx?.providerRegistry ?? PROVIDER_REGISTRY;
  const store = ctx?.projectWriteStore;

  if (typeof subactionOrPartsCount === "number") {
    subaction = undefined;
    partsCount = subactionOrPartsCount;
    req = partsCountOrReq as Request;
  } else {
    subaction = subactionOrPartsCount;
    partsCount = typeof partsCountOrReq === "number" ? partsCountOrReq : 0;
    req = maybeReq as Request;
  }

  const isDiscover =
    id === "discover-repositories" ||
    id === "discover" ||
    id === "repositories";
  if (isDiscover && method === "POST")
    return handleDiscoverRepositories(req, registry);

  const isInspect =
    id === "inspect-repository" || id === "quick-inspect" || id === "inspect";
  if (isInspect && method === "POST") return handleInspectRepository(req);

  const isConfigureIdentity = id === "configure-git-identity";
  if (isConfigureIdentity && method === "POST") {
    return handleConfigureGitIdentity(req);
  }

  const isTest = id === "test-connection" || id === "test-tracker";
  if (isTest && method === "POST") return handleTestConnection(req);

  // The wire path supports generic /api/projects/test-scopes, while keeping
  // its historical test-azure-scopes route as a legacy wire alias.
  const isTestScopes = id === "test-scopes" || id === "test-azure-scopes";
  if (isTestScopes && method === "POST") {
    return handleTestProviderScopes(req, registry);
  }

  const isCheckPath = id === "check-path" || id === "validate-path";
  if (isCheckPath && method === "POST") return handleCheckPath(req);

  if (!id) {
    if (method === "GET") return handleGetProjects(req);
    if (method === "POST") return handleCreateProject(req, registry, store);
    return null;
  }

  if (action === "migrate" && method === "POST") {
    if (!ctx) throw new Error("Project migration needs the composition root.");
    return handleMigrateProject(id, req, registry, ctx.repos);
  }

  return handleProjectMemberRoute(
    method,
    id,
    action,
    subaction,
    partsCount,
    req,
    registry,
    store,
  );
}
