// src/http/route-table.ts — the one declarative route table driving API
// dispatch (#192).
//
// Each entry is method + path pattern → handler, plus the metadata the OpenAPI
// document needs. `dispatchApi` matches a request against the table and hands
// the handler one uniform `RouteRequest` with typed params; controllers never
// count path segments or read positional parts. An unmatched request is
// `null`, which `handleApi` turns into the canonical 404.
//
// The `/api/openapi(.json)` endpoints document the table itself, so their
// handlers build the document from `ROUTE_TABLE`.

import type { ApiContext } from "../composition-root.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import {
  handleDiagnosticsRoute,
  handleHealthRoute,
  handleReadinessRoute,
  handleReadyRoute,
} from "./diagnostics-controller.js";
import { handleDocsRoute } from "./docs-controller.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  handleCheckPath,
  handleConfigureGitIdentity,
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleGetProjectReadiness,
  handleGetProjects,
  handleGetProjectTickets,
  handleGetProjectTracker,
  handleInspectRepository,
  handleMigrateProject,
  handleTestProjectTracker,
  handleUpdateProject,
  handleUpdateProjectTrackerCredentials,
  handleVerifyProjectScopes,
  projectRoute,
} from "./projects-controller.js";
import {
  handleDescribeRoute,
  handleManifestRoute,
  handleParseUrlRoute,
  handleRepositoriesRoute,
  handleVerifyRoute,
} from "./providers-controller.js";
import { catchHttpErrors, jsonResponse } from "./responses.js";
import type { RouteEntry, RouteRequest } from "./route-contract.js";
import {
  handleAbandonRun,
  handleChatMessage,
  handleCreatePR,
  handleCreateRun,
  handleGetRun,
  handleGetRuns,
  handleResumeRun,
  handleRunEvents,
  handleStopRun,
  handleTransitions,
} from "./runs-controller.js";
import {
  handleGetSettings,
  handleUpdateSettings,
} from "./settings-controller.js";

const registryOf = (ctx: ApiContext): ProviderRegistry =>
  ctx.providerRegistry ?? PROVIDER_REGISTRY;

/** The generated document for the current table. */
export function getOpenApiSpec() {
  return buildOpenApiDocument(ROUTE_TABLE);
}

const openApiHandler = () => jsonResponse(getOpenApiSpec());

/**
 * Every API route, declared once. Static patterns come before `{param}`
 * patterns with the same shape so a literal segment always wins.
 */
export const ROUTE_TABLE: readonly RouteEntry[] = [
  {
    method: "GET",
    path: "/api/health",
    tags: ["Health"],
    summary: "Health Check",
    operationId: "getHealth",
    responseDescription: "Server status, uptime and version",
    handler: () => handleHealthRoute(),
  },
  {
    // The liveness probe used to answer any method; POST is kept so existing
    // clients and the request-guard's allowance checks stay compatible (#192).
    method: "POST",
    path: "/api/health",
    tags: ["Health"],
    summary: "Health Check (any method)",
    operationId: "postHealth",
    responseDescription: "Server status, uptime and version",
    handler: () => handleHealthRoute(),
  },
  {
    method: "GET",
    path: "/api/ready",
    tags: ["Health"],
    summary: "Readiness Probe",
    operationId: "getReady",
    responseDescription: "Ready when the database and a worker are available",
    handler: ({ ctx }) => handleReadyRoute(ctx.repos),
  },
  {
    method: "GET",
    path: "/api/readiness",
    tags: ["Health"],
    summary: "UI Readiness",
    operationId: "getReadiness",
    responseDescription: "Full readiness assessment for the dashboard",
    handler: ({ ctx }) => handleReadinessRoute(ctx.repos),
  },
  {
    method: "GET",
    path: "/api/diagnostics",
    tags: ["Health"],
    summary: "Operational Diagnostics",
    operationId: "getDiagnostics",
    responseDescription: "Database counts, active jobs and the worker fleet",
    handler: ({ ctx }) => handleDiagnosticsRoute(ctx.repos),
  },
  {
    method: "GET",
    path: "/api/openapi.json",
    tags: ["Docs"],
    summary: "OpenAPI Document",
    operationId: "getOpenApiDocument",
    responseDescription: "The generated OpenAPI 3.1.0 document",
    handler: openApiHandler,
  },
  {
    method: "GET",
    path: "/api/openapi",
    tags: ["Docs"],
    summary: "OpenAPI Document (alias)",
    operationId: "getOpenApiDocumentAlias",
    responseDescription: "The generated OpenAPI 3.1.0 document",
    handler: openApiHandler,
  },
  {
    method: "GET",
    path: "/api/docs",
    tags: ["Docs"],
    summary: "Documentation Catalog",
    operationId: "getDocsCatalog",
    responseDescription: "Diátaxis categories and documents",
    handler: ({ req }) => handleDocsRoute("GET", undefined, undefined, req),
  },
  {
    method: "GET",
    path: "/api/docs/search",
    tags: ["Docs"],
    summary: "Search Documentation",
    operationId: "searchDocs",
    responseDescription: "Section-level matches across the documentation index",
    handler: ({ req }) => handleDocsRoute("GET", "search", undefined, req),
  },
  {
    method: "GET",
    path: "/api/docs/{category}/{slug}",
    tags: ["Docs"],
    summary: "Get Document",
    operationId: "getDoc",
    responseDescription: "The markdown body of one document",
    handler: ({ req, params }) =>
      handleDocsRoute("GET", params.category, params.slug, req),
  },
  {
    method: "GET",
    path: "/api/settings",
    tags: ["Settings"],
    summary: "Get Settings",
    operationId: "getSettings",
    responseDescription: "The masked workbench settings",
    handler: () => handleGetSettings(),
  },
  {
    method: "POST",
    path: "/api/settings",
    tags: ["Settings"],
    summary: "Update Settings",
    operationId: "updateSettings",
    responseDescription: "The updated workbench settings",
    handler: ({ req }) => handleUpdateSettings(req),
  },
  // Projects — static patterns first, then member patterns.
  {
    method: "POST",
    path: "/api/projects/inspect-repository",
    tags: ["Projects"],
    summary: "Inspect Repository",
    operationId: "inspectRepository",
    responseDescription: "Local repository identity, tooling and readiness",
    handler: projectRoute(({ req }) => handleInspectRepository(req)),
  },
  {
    method: "POST",
    path: "/api/projects/configure-git-identity",
    tags: ["Projects"],
    summary: "Configure Git Identity",
    operationId: "configureGitIdentity",
    responseDescription: "The resolved repository git identity",
    handler: projectRoute(({ req }) => handleConfigureGitIdentity(req)),
  },
  {
    method: "POST",
    path: "/api/projects/check-path",
    tags: ["Projects"],
    summary: "Check Local Path",
    operationId: "checkPath",
    responseDescription: "Whether the path exists and the git repos it holds",
    handler: projectRoute(({ req }) => handleCheckPath(req)),
  },
  {
    method: "GET",
    path: "/api/projects",
    tags: ["Projects"],
    summary: "List Projects",
    operationId: "listProjects",
    responseDescription: "Configured multi-repository projects",
    handler: projectRoute(({ req }) => handleGetProjects(req)),
  },
  {
    method: "POST",
    path: "/api/projects",
    tags: ["Projects"],
    summary: "Create Project",
    operationId: "createProject",
    responseDescription: "The created project",
    handler: projectRoute(({ req, ctx }) =>
      handleCreateProject(req, registryOf(ctx), ctx.projectWriteStore),
    ),
  },
  {
    method: "GET",
    path: "/api/projects/{id}",
    tags: ["Projects"],
    summary: "Get Project",
    operationId: "getProject",
    responseDescription: "The project with its readiness",
    handler: projectRoute(({ params }) =>
      handleGetProject(params.id as string),
    ),
  },
  {
    method: "PUT",
    path: "/api/projects/{id}",
    tags: ["Projects"],
    summary: "Update Project",
    operationId: "replaceProject",
    responseDescription: "The updated project",
    handler: projectRoute(({ req, params, ctx }) =>
      handleUpdateProject(
        params.id as string,
        req,
        registryOf(ctx),
        ctx.projectWriteStore,
      ),
    ),
  },
  {
    method: "PATCH",
    path: "/api/projects/{id}",
    tags: ["Projects"],
    summary: "Update Project (partial)",
    operationId: "patchProject",
    responseDescription: "The updated project",
    handler: projectRoute(({ req, params, ctx }) =>
      handleUpdateProject(
        params.id as string,
        req,
        registryOf(ctx),
        ctx.projectWriteStore,
      ),
    ),
  },
  {
    method: "DELETE",
    path: "/api/projects/{id}",
    tags: ["Projects"],
    summary: "Delete Project",
    operationId: "deleteProject",
    responseDescription: "Confirmation that the project was removed",
    handler: projectRoute(({ params }) =>
      handleDeleteProject(params.id as string),
    ),
  },
  {
    method: "POST",
    path: "/api/projects/{id}/migrate",
    tags: ["Projects"],
    summary: "Migrate Project",
    operationId: "migrateProject",
    responseDescription: "The archived predecessor and the new project",
    handler: projectRoute(({ req, params, ctx }) =>
      handleMigrateProject(
        params.id as string,
        req,
        registryOf(ctx),
        ctx.repos,
      ),
    ),
  },
  {
    method: "GET",
    path: "/api/projects/{id}/tickets",
    tags: ["Projects"],
    summary: "Get Project Tickets",
    operationId: "getProjectTickets",
    responseDescription: "Tickets from the project's tracker",
    handler: projectRoute(({ params, ctx }) =>
      handleGetProjectTickets(params.id as string, registryOf(ctx)),
    ),
  },
  {
    method: "GET",
    path: "/api/projects/{id}/readiness",
    tags: ["Projects"],
    summary: "Get Project Readiness",
    operationId: "getProjectReadiness",
    responseDescription: "The project's readiness assessment",
    handler: projectRoute(({ params }) =>
      handleGetProjectReadiness(params.id as string),
    ),
  },
  {
    method: "GET",
    path: "/api/projects/{id}/tracker",
    tags: ["Projects"],
    summary: "Get Project Tracker",
    operationId: "getProjectTracker",
    responseDescription: "The resolved tracker connection summary",
    handler: projectRoute(({ params, ctx }) =>
      handleGetProjectTracker(params.id as string, registryOf(ctx)),
    ),
  },
  {
    method: "PUT",
    path: "/api/projects/{id}/tracker/credentials",
    tags: ["Projects"],
    summary: "Update Project Tracker Credentials",
    operationId: "updateProjectTrackerCredentials",
    responseDescription: "Confirmation that credentials were stored",
    handler: projectRoute(({ req, params, ctx }) =>
      handleUpdateProjectTrackerCredentials(
        params.id as string,
        req,
        registryOf(ctx),
      ),
    ),
  },
  {
    method: "POST",
    path: "/api/projects/{id}/tracker/credentials",
    tags: ["Projects"],
    summary: "Update Project Tracker Credentials",
    operationId: "updateProjectTrackerCredentialsPost",
    responseDescription: "Confirmation that credentials were stored",
    handler: projectRoute(({ req, params, ctx }) =>
      handleUpdateProjectTrackerCredentials(
        params.id as string,
        req,
        registryOf(ctx),
      ),
    ),
  },
  {
    method: "POST",
    path: "/api/projects/{id}/tracker/test",
    tags: ["Projects"],
    summary: "Test Project Tracker",
    operationId: "testProjectTracker",
    responseDescription: "The stored tracker connection's probe result",
    handler: projectRoute(({ req, params, ctx }) =>
      handleTestProjectTracker(params.id as string, req, registryOf(ctx)),
    ),
  },
  {
    method: "POST",
    path: "/api/projects/{id}/tracker/scopes",
    tags: ["Projects"],
    summary: "Verify Project Scopes",
    operationId: "verifyProjectScopes",
    responseDescription: "The scope verification report",
    handler: projectRoute(({ params, ctx }) =>
      handleVerifyProjectScopes(params.id as string, registryOf(ctx)),
    ),
  },

  // Runs.
  {
    method: "GET",
    path: "/api/runs",
    tags: ["Runs"],
    summary: "List Runs",
    operationId: "listRuns",
    responseDescription: "Run summaries",
    handler: ({ ctx }) => handleGetRuns(ctx.repos),
  },
  {
    method: "POST",
    path: "/api/runs",
    tags: ["Runs"],
    summary: "Create Run",
    operationId: "createRun",
    responseDescription: "The created run",
    handler: ({ req, ctx }) => handleCreateRun(ctx.repos, req),
  },
  {
    method: "GET",
    path: "/api/runs/{id}",
    tags: ["Runs"],
    summary: "Get Run",
    operationId: "getRun",
    responseDescription: "The run with its stages and artifacts",
    handler: ({ params, ctx }) => handleGetRun(ctx.repos, params.id as string),
  },
  {
    method: "GET",
    path: "/api/runs/{id}/events",
    tags: ["Runs"],
    summary: "Stream Run Events",
    operationId: "streamRunEvents",
    responseDescription: "Server-Sent Events stream of run events",
    handler: ({ req, params, ctx }) =>
      handleRunEvents(ctx.repos, params.id as string, req),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/chat",
    tags: ["Runs"],
    summary: "Chat With Run",
    operationId: "chatWithRun",
    responseDescription: "The agent's reply",
    handler: ({ req, params, ctx }) =>
      handleChatMessage(ctx.repos, req, params.id as string),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/transitions",
    tags: ["Runs"],
    summary: "Transition Run",
    operationId: "transitionRun",
    responseDescription: "The run after the transition",
    handler: ({ req, params, ctx }) =>
      handleTransitions(ctx.repos, req, params.id as string),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/stop",
    tags: ["Runs"],
    summary: "Stop Run",
    operationId: "stopRun",
    responseDescription: "The stopped run",
    handler: ({ params, ctx }) => handleStopRun(ctx.repos, params.id as string),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/pr",
    tags: ["Runs"],
    summary: "Create Pull Request",
    operationId: "createPullRequest",
    responseDescription: "The created pull request",
    handler: ({ params, ctx }) =>
      handleCreatePR(ctx.repos, params.id as string),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/resume",
    tags: ["Runs"],
    summary: "Resume Run",
    operationId: "resumeRun",
    responseDescription: "The resumed run",
    handler: ({ params, ctx }) =>
      handleResumeRun(ctx.repos, params.id as string),
  },
  {
    method: "POST",
    path: "/api/runs/{id}/abandon",
    tags: ["Runs"],
    summary: "Abandon Run",
    operationId: "abandonRun",
    responseDescription: "The abandoned run",
    handler: ({ req, params, ctx }) =>
      handleAbandonRun(ctx.repos, req, params.id as string),
  },
  // Providers.
  {
    method: "GET",
    path: "/api/providers/manifest",
    tags: ["Providers"],
    summary: "Provider Manifest",
    operationId: "getProviderManifest",
    responseDescription: "Provider descriptors, capabilities and config fields",
    handler: ({ req, url, ctx }) =>
      catchHttpErrors(() => handleManifestRoute(req, url, registryOf(ctx))),
  },
  {
    method: "POST",
    path: "/api/providers/verify",
    tags: ["Providers"],
    summary: "Verify Provider Credentials",
    operationId: "verifyProviderCredentials",
    responseDescription: "Verification result or a normalized provider error",
    handler: ({ req, ctx }) =>
      catchHttpErrors(() => handleVerifyRoute(req, registryOf(ctx))),
  },
  {
    method: "POST",
    path: "/api/providers/parse-url",
    tags: ["Providers"],
    summary: "Parse Provider URL",
    operationId: "parseProviderUrl",
    responseDescription: "A connection draft or an unmatched-URL fallback",
    handler: ({ req, ctx }) =>
      catchHttpErrors(() => handleParseUrlRoute(req, registryOf(ctx))),
  },
  {
    method: "POST",
    path: "/api/providers/repositories",
    tags: ["Providers"],
    summary: "Discover Provider Repositories",
    operationId: "discoverProviderRepositories",
    responseDescription: "Visible repositories or a normalized provider error",
    handler: ({ req, ctx }) =>
      catchHttpErrors(() => handleRepositoriesRoute(req, registryOf(ctx))),
  },
  {
    method: "POST",
    path: "/api/providers/describe",
    tags: ["Providers"],
    summary: "Describe Provider Connection",
    operationId: "describeProviderConnection",
    responseDescription: "The non-secret connection identity, or null",
    handler: ({ req, ctx }) =>
      catchHttpErrors(() => handleDescribeRoute(req, registryOf(ctx))),
  },
];

function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** The named params when `actual` matches `pattern`, otherwise `null`. */
function matchSegments(
  pattern: string,
  actual: readonly string[],
): Record<string, string> | null {
  const expected = segmentsOf(pattern);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i += 1) {
    const segment = expected[i] as string;
    const value = actual[i] as string;
    if (segment.startsWith("{") && segment.endsWith("}")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // A malformed percent-escape is not a route match, not a 500.
        return null;
      }
      params[segment.slice(1, -1)] = decoded;
    } else if (segment !== value) {
      return null;
    }
  }
  return params;
}

/**
 * Dispatches a request against the table. Returns `null` when no entry matches
 * the method + path, so the caller can answer the canonical 404.
 */
export async function dispatchApi(
  req: Request,
  url: URL,
  ctx: ApiContext,
): Promise<Response | null> {
  const actual = segmentsOf(url.pathname);
  for (const entry of ROUTE_TABLE) {
    if (entry.method !== req.method) continue;
    const params = matchSegments(entry.path, actual);
    if (params) {
      const request: RouteRequest = { req, url, params, ctx };
      return entry.handler(request);
    }
  }
  return null;
}
