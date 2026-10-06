// src/http/projects-controller.ts — Multi-repository project CRUD, onboarding, tracker secrets, and migration endpoints.

import { stat } from "node:fs/promises";
import path from "node:path";
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
  resolveProjectProvider,
  resolveProjectTrackerSummary,
  testProjectTrackerConnection,
} from "../providers/project-config.js";
import { redactConfigForProvider } from "../providers/redaction.js";
import {
  getProvider,
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import { getRunRepository } from "../runs.js";
import {
  createProjectFromConnections,
  updateProjectConnections,
} from "../services/project-creation.js";
import type { IssueTrackerProvider } from "../shared/types.js";
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
): Promise<Response> {
  return withValidatedBody(
    req,
    SaveProjectBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        // The validated union's own discrimination decides the path (#131):
        // a payload that satisfies the normalized connections branch creates
        // through it; everything else keeps the legacy configuration path.
        const saved = isConnectionsProjectInput(body)
          ? await createProjectFromConnections(body, { registry })
          : await createProject(body);
        return jsonResponse(saved, 201);
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

/**
 * The raw update body's discriminator: it is NOT validated against a union, so
 * the presence of a `connections` array is the only signal available here. The
 * create path never needs this — its validated union already decided.
 */
function hasConnections(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { connections?: unknown }).connections)
  );
}

async function handleUpdateProject(
  projectId: string,
  req: Request,
  registry: ProviderRegistry,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  const raw = await parseJsonBody(req);
  if (!raw) return errorResponse("Invalid JSON for project update.", 400);

  // Connection updates go through the normalized path (#145); every other
  // update keeps the existing merge-and-save behaviour.
  if (hasConnections(raw)) {
    const validated = validateAgainstSchema(
      raw,
      UpdateProjectConnectionsBodySchema,
    );
    if (!validated.ok) return validated.response;
    return catchHttpErrors(async () => {
      const saved = await updateProjectConnections(project, validated.data, {
        registry,
      });
      return jsonResponse(saved);
    });
  }

  return catchHttpErrors(async () => {
    // The merge-and-save path: an update body that carries no `connections`
    // array is merged onto the existing record as an open object — there is no
    // schema left to reject it against, so nothing is validated here. (A schema
    // that can never fail is not a validation step.)
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

async function handleDiscoverRepositories(req: Request): Promise<Response> {
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
        const provider = getProvider(providerId);
        if (!provider || !hasCapability(provider, "listRepositories")) {
          return errorResponse(
            `Unsupported discovery provider: ${providerId}`,
            400,
          );
        }
        const repos = await provider.listRepositories(body);
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
  const providerId =
    project.issueTracker?.provider || project.issueTracker?.connectionId;
  if (!providerId) {
    return errorResponse(
      `Project "${projectId}" has no issue tracker configured.`,
      400,
    );
  }
  const provider = getProvider(providerId, registry);
  if (!provider || !hasCapability(provider, "listTickets")) {
    return errorResponse(
      `Unsupported issue tracker provider: "${providerId}".`,
      400,
    );
  }

  const env = await loadProjectEnv(projectId);
  const { config } = resolveProjectProvider(project, env, registry);
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
  const summary = resolveProjectTrackerSummary(project.issueTracker, env);
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
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  return withJsonBody<Record<string, string>>(
    req,
    async (body) => {
      const provider =
        project.issueTracker?.provider ||
        project.issueTracker?.connectionId ||
        "github";
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
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  const processRequest = async (bodyData: Record<string, unknown>) => {
    const tracker = project.issueTracker;
    const provider = (bodyData.provider ||
      tracker?.provider ||
      tracker?.connectionId ||
      "github") as IssueTrackerProvider;
    const env = await loadProjectEnv(projectId);

    const result = await testProjectTrackerConnection(
      provider,
      tracker,
      env,
      bodyData,
      project.repositoryPath,
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
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  if (project.archived) {
    return errorResponse(`Project "${projectId}" is already archived.`, 400);
  }

  // Active run guard
  const runs = getRunRepository().list();
  const activeRun = runs.find(
    (r) =>
      r.project.id === projectId &&
      !["pr_created", "failed", "stopped"].includes(r.status),
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
        buildProjectMigrationPlan(project, body);

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
): Promise<Response | null> {
  switch (method) {
    case "GET":
      return handleGetProject(id);
    case "PATCH":
    case "PUT":
      return handleUpdateProject(id, req, registry);
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
      return handleUpdateProjectTrackerCredentials(id, req);
    }
    if (subaction === "test" && method === "POST") {
      return handleTestProjectTracker(id, req);
    }
  }
  if (action === "migrate" && method === "POST") {
    return handleMigrateProject(id, req);
  }
  if (!action && partsCount === 2) {
    return handleProjectMemberCrud(method, id, req, registry);
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
      const providerId = (data.provider as string) || "azure";
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
  const recorded =
    project?.issueTracker?.provider || project?.issueTracker?.connectionId;
  return recorded ? getProvider(recorded, registry) : undefined;
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
          errors: [
            "No tracker connection resolved for scope verification: pass a projectId with a registered tracker connection, or an explicit providerId.",
          ],
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
  customRegistry?: ProviderRegistry,
): Promise<Response | null> {
  let subaction: string | undefined;
  let partsCount: number;
  let req: Request;
  const registry = customRegistry ?? PROVIDER_REGISTRY;

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
  if (isDiscover && method === "POST") return handleDiscoverRepositories(req);

  const isInspect =
    id === "inspect-repository" || id === "quick-inspect" || id === "inspect";
  if (isInspect && method === "POST") return handleInspectRepository(req);

  const isTest = id === "test-connection" || id === "test-tracker";
  if (isTest && method === "POST") return handleTestConnection(req);

  // The wire path keeps its historical provider-named route (the api-client and
  // the OpenAPI document reference it); the handler behind it does not.
  const isTestScopes = id === "test-azure-scopes";
  if (isTestScopes && method === "POST") {
    return handleTestProviderScopes(req, registry);
  }

  const isCheckPath = id === "check-path" || id === "validate-path";
  if (isCheckPath && method === "POST") return handleCheckPath(req);

  if (!id) {
    if (method === "GET") return handleGetProjects(req);
    if (method === "POST") return handleCreateProject(req, registry);
    return null;
  }

  return handleProjectMemberRoute(
    method,
    id,
    action,
    subaction,
    partsCount,
    req,
    registry,
  );
}
