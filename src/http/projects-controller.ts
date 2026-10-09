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
import { ConnectionConflictError } from "../errors.js";
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
  REQUIRED_WORKFLOW_LABEL,
  type ScopeVerificationReport,
} from "../providers/contract.js";
import { ProviderError } from "../providers/errors.js";
import {
  buildProjectMigrationPlan,
  extractTrackerCredentialsToSave,
  type ProjectMigrationInput,
  resolveProjectTrackerSummary,
  testProjectTrackerConnection,
} from "../providers/project-config.js";
import {
  findConnectionForRole,
  type ResolvedProjectConnection,
  resolveProjectConnection,
} from "../providers/project-connections.js";
import { redactConfigForProvider } from "../providers/redaction.js";
import {
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
import type { Project } from "../types.js";
import {
  catchHttpErrors,
  errorResponse,
  jsonResponse,
  parseJsonBody,
  providerErrorResponse,
  translateDomainErrorToHttpResponse,
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

/**
 * The tracker connection a project-scoped tracker action must use, or the
 * Response that explains why there is none. The ticket list and the scope
 * diagnostic both resolve through here, so the two can never disagree about
 * which connection is the project's tracker, nor about why one is missing.
 */
async function resolveProjectTrackerConnection(
  project: Project,
  registry: ProviderRegistry,
): Promise<
  | { readonly ok: true; readonly connection: ResolvedProjectConnection }
  | { readonly ok: false; readonly response: Response }
> {
  const env = await loadProjectEnv(project.id);
  const connection = resolveProjectConnection(
    project,
    "tracker",
    env,
    registry,
  );
  if (!connection) {
    return {
      ok: false,
      response: errorResponse(
        `Project "${project.id}" has no issue tracker configured.`,
        400,
      ),
    };
  }
  return { ok: true, connection };
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
  const resolved = await resolveProjectTrackerConnection(project, registry);
  if (!resolved.ok) return resolved.response;
  const { provider, config } = resolved.connection;
  if (!hasCapability(provider, "listTickets")) {
    return errorResponse(
      `Unsupported issue tracker provider: "${provider.id}".`,
      400,
    );
  }
  const requiredLabel =
    (config.requiredLabel as string | undefined) || REQUIRED_WORKFLOW_LABEL;

  try {
    return jsonResponse(await provider.listTickets(config, { requiredLabel }));
  } catch (err: unknown) {
    // The registry's provider throws only normalized ProviderErrors.
    if (err instanceof ProviderError) return providerErrorResponse(err);
    throw err;
  }
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
    if (subaction === "scopes" && method === "POST") {
      return handleVerifyProjectScopes(id, registry);
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

/**
 * POST /api/projects/:id/tracker/scopes — "Verify scopes" on an existing
 * project (#183). The project's OWN tracker connection is the diagnostic's
 * subject: it is resolved through the project connections module, so the config
 * the provider is probed with is the recorded connection plus the project's
 * stored secrets — never anything the request body carries. The body is not
 * read at all.
 *
 * Failures cross the boundary as the provider's normalized (code, context)
 * envelope; a raw provider message never reaches the client.
 */
async function handleVerifyProjectScopes(
  projectId: string,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  const resolved = await resolveProjectTrackerConnection(project, registry);
  if (!resolved.ok) return resolved.response;
  const { provider, config } = resolved.connection;
  if (!hasCapability(provider, "verifyScopes")) {
    return jsonResponse({
      ok: false,
      overPrivileged: false,
      scopes: {},
      errors: [
        "The resolved tracker provider does not support scope verification.",
      ],
      warnings: [],
    });
  }

  let report: ScopeVerificationReport;
  try {
    report = await provider.verifyScopes(config);
  } catch (err: unknown) {
    // Normalized envelope only: the thrown text (which may quote the
    // configuration) never crosses this boundary.
    return jsonResponse({
      ok: false,
      overPrivileged: false,
      scopes: {},
      errors: [],
      warnings: [],
      error: provider.toUserError(err, "VERIFY"),
    });
  }

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

  return jsonResponse({
    ok: errors.length === 0,
    overPrivileged: report.overPrivileged,
    scopes,
    errors,
    warnings,
  });
}

/**
 * Routes a project request. A stored record whose connection settings conflict
 * answers 409 with its code instead of crashing the route.
 */
export async function handleProjectsRoute(
  ...args: Parameters<typeof routeProjectsRequest>
): Promise<Response | null> {
  try {
    return await routeProjectsRequest(...args);
  } catch (err) {
    const mapped =
      err instanceof ConnectionConflictError
        ? translateDomainErrorToHttpResponse(err)
        : null;
    if (mapped) return mapped;
    throw err;
  }
}

async function routeProjectsRequest(
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

  const isInspect =
    id === "inspect-repository" || id === "quick-inspect" || id === "inspect";
  if (isInspect && method === "POST") return handleInspectRepository(req);

  const isConfigureIdentity = id === "configure-git-identity";
  if (isConfigureIdentity && method === "POST") {
    return handleConfigureGitIdentity(req);
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
