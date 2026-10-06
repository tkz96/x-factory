// src/http/openapi.ts — OpenAPI 3.1.0 specification for X-Factory developer workbench REST API.

export function getOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "X-Factory API",
      version: "0.1.0",
      description:
        "Software engineering workbench REST API: ticket → Pi agent → implementation → tests → PR. Provides programmatic control over multi-repository projects, repository discovery and inspection, execution runs, steering, pull requests, and workbench settings.",
      contact: {
        name: "X-Factory Team",
        url: "https://github.com/scalar/scalar",
      },
      license: {
        name: "Private",
      },
    },
    servers: [
      {
        url: "/",
        description: "Local / Active X-Factory Server",
      },
    ],
    tags: [
      {
        name: "Health",
        description: "Service status and uptime verification",
      },
      {
        name: "Projects",
        description:
          "Project management, tracker authentication, and repository mapping",
      },
      {
        name: "Discovery",
        description:
          "Online and local repository discovery (Azure DevOps, GitHub, Jira, local disk)",
      },
      {
        name: "Inspection",
        description:
          "Local directory inspection, tooling detection, and test commands",
      },
      {
        name: "Runs",
        description:
          "Agent execution lifecycle, event streaming, real-time steering, and PR delivery",
      },
      {
        name: "Settings",
        description:
          "Global workbench configuration and LLM provider credentials",
      },
      {
        name: "Providers",
        description:
          "Provider manifest discovery, credential verification, and Quick-URL resolution",
      },
    ],
    paths: {
      "/api/health": {
        get: {
          tags: ["Health"],
          summary: "Health Check",
          description:
            "Returns server status, process uptime in seconds, and semantic version.",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Server is healthy and ready",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/HealthResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects": {
        get: {
          tags: ["Projects"],
          summary: "List Projects",
          description:
            "Retrieves all configured multi-repository projects with option to include archived projects.",
          operationId: "listProjects",
          parameters: [
            {
              name: "includeArchived",
              in: "query",
              description: "Whether to include archived projects in results",
              required: false,
              schema: {
                type: "boolean",
                default: false,
              },
            },
          ],
          responses: {
            "200": {
              description: "Array of configured projects",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Project",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Create Project",
          description:
            "Creates and saves a new multi-repository project configuration. " +
            "A payload carrying `connections` (the normalized onboarding payload, #131) " +
            "is validated against each registered provider's own schema and role " +
            "capabilities; its secret fields are written to per-project environment " +
            "storage (secrets first, project record last) and never appear in the " +
            "response or the stored record.",
          operationId: "createProject",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/ProjectCreationRequest" },
                    { $ref: "#/components/schemas/ProjectInput" },
                  ],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Project created successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Project",
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
            "409": {
              description:
                "Semantic validation failure (unknown provider, provider config schema, incompatible role/capability) or a duplicate project id",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/FormErrorResponse" },
                      { $ref: "#/components/schemas/ErrorResponse" },
                    ],
                  },
                },
              },
            },
            "500": {
              $ref: "#/components/responses/InternalError",
            },
          },
        },
      },
      "/api/projects/{id}": {
        get: {
          tags: ["Projects"],
          summary: "Get Project Details",
          description:
            "Retrieves project configuration along with readiness validation checks across all linked repositories.",
          operationId: "getProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Project details with readiness report",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ProjectWithReadiness",
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Update Project",
          description:
            "Updates project settings, repositories, or issue tracker details. " +
            "A body carrying `connections` takes the normalized connection-update " +
            "contract (#131): a missing or empty secret keeps the stored value, and " +
            "`clearSecrets` names the secret fields to remove (applied before " +
            "validation).",
          operationId: "updateProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/ProjectConnectionUpdate" },
                    { type: "object", additionalProperties: true },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated project details",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Project",
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
            "409": {
              description:
                "Semantic validation failure for a connection update (unknown provider, provider config schema, incompatible role, cleared required secret)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/FormErrorResponse",
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["Projects"],
          summary: "Delete Project",
          description: "Permanently removes a project from the configuration.",
          operationId: "deleteProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Project deleted successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      id: { type: "string", example: "x-factory" },
                    },
                    required: ["ok", "id"],
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
      },
      "/api/projects/{id}/tickets": {
        get: {
          tags: ["Projects"],
          summary: "Get Project Tickets",
          description:
            "Polls the configured issue tracker (Azure DevOps, GitHub, Jira) for active work items tagged 'agentic-workflow'.",
          operationId: "getProjectTickets",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Array of fetched tickets",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Ticket",
                    },
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
      },
      "/api/projects/{id}/env": {
        get: {
          tags: ["Projects"],
          summary: "Get Project Environment Variables",
          description:
            "Retrieves project-scoped environment variables with secrets masked for safe display.",
          operationId: "getProjectEnv",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Dictionary of project environment variables",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        value: { type: "string" },
                        isSecret: { type: "boolean" },
                        maskedValue: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Update Project Environment Variables",
          description:
            "Saves encrypted/masked project-level environment variables (e.g. tracker PAT tokens, custom keys).",
          operationId: "updateProjectEnv",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated environment variables successfully saved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/repos": {
        get: {
          tags: ["Projects"],
          summary: "Get Project Repositories",
          description:
            "Lists configured repositories and auto-discovered repositories for a project.",
          operationId: "getProjectRepos",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "List of repositories",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/DiscoveredRepository",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/test-connection": {
        post: {
          tags: ["Projects"],
          summary: "Test Project Tracker Connection",
          description:
            "Tests connectivity, authentication, and permission scopes for the project's configured issue tracker.",
          operationId: "testProjectConnection",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Connection probe results",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ConnectionTestResult",
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/discover-repositories": {
        post: {
          tags: ["Discovery"],
          summary: "Discover Repositories",
          description:
            "Scans Azure DevOps organizations, GitHub accounts, Jira links, or local directory paths to discover available Git repositories.",
          operationId: "discoverRepositories",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["provider"],
                  properties: {
                    provider: {
                      type: "string",
                      enum: ["azure", "github", "gitlab", "jira", "local"],
                      example: "azure",
                    },
                    orgUrl: {
                      type: "string",
                      example: "https://dev.azure.com/my-org",
                    },
                    project: { type: "string", example: "CorePlatform" },
                    pat: { type: "string", example: "••••••••" },
                    localPath: { type: "string", example: "~/code/workbench" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Discovered repositories",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      repositories: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/DiscoveredRepository",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/inspect-repository": {
        post: {
          tags: ["Inspection"],
          summary: "Inspect Repository Tooling",
          description:
            "Analyzes a local repository folder to detect package managers (bun, npm, pnpm, yarn), test frameworks, linters, and verification scripts.",
          operationId: "inspectRepository",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["path"],
                  properties: {
                    path: { type: "string", example: "~/code/x-factory" },
                    remote: {
                      type: "string",
                      example: "https://github.com/my-org/my-repo",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Repository tooling analysis result",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/RepositoryInspectionResult",
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/test-azure-scopes": {
        post: {
          tags: ["Discovery"],
          summary: "Verify Tracker Provider Scopes",
          description:
            "Probes the resolved tracker provider's credentials for the capabilities that provider must hold. The provider is resolved from `providerId`, or from the tracker connection recorded on `projectId`; a connection whose provider does not declare the `verifyScopes` capability is reported as a capability gap, never substituted for. The path keeps its historical provider-named form.",
          operationId: "testAzureScopes",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    providerId: {
                      type: "string",
                      example: "azure-devops",
                    },
                    projectId: { type: "string", example: "proj-1" },
                    orgUrl: {
                      type: "string",
                      example: "https://dev.azure.com/my-org",
                    },
                    project: { type: "string", example: "Platform" },
                    pat: { type: "string", example: "token-string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Provider scope audit report",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ScopeVerificationResult",
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/check-path": {
        post: {
          tags: ["Inspection"],
          summary: "Check Local Filesystem Path",
          description:
            "Validates whether a specified file or directory path exists on the host machine and checks if it is a directory.",
          operationId: "checkPath",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["path"],
                  properties: {
                    path: { type: "string", example: "~/code/repo" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Path existence information",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      exists: { type: "boolean" },
                      isDirectory: { type: "boolean" },
                      resolvedPath: { type: "string" },
                    },
                    required: ["exists", "isDirectory"],
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs": {
        get: {
          tags: ["Runs"],
          summary: "List Runs",
          description:
            "Retrieves a list of all historical and active execution runs.",
          operationId: "listRuns",
          responses: {
            "200": {
              description: "Array of run summaries",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/RunSummary",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Runs"],
          summary: "Start New Run",
          description:
            "Initializes a Pi coding agent run to implement a ticket in an isolated git worktree.",
          operationId: "createRun",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CreateRunRequest",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Run created and execution started",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Run",
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
      },
      "/api/runs/{id}": {
        get: {
          tags: ["Runs"],
          summary: "Get Run Details",
          description:
            "Retrieves full details, stage status, collected events, worktree information, and pull request links for a run.",
          operationId: "getRun",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier (e.g. run-1710900000000)",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Run details",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Run",
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
      },
      "/api/runs/{id}/events": {
        get: {
          tags: ["Runs"],
          summary: "Stream Run Events (SSE)",
          description:
            "Subscribes to live Server-Sent Events (SSE) for real-time progress, agent thoughts, commands, and verification logs.",
          operationId: "streamRunEvents",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Server-Sent Events stream",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    example:
                      'data: {"type":"info","text":"Starting implementation stage..."}\n\n',
                  },
                },
              },
            },
            "404": {
              $ref: "#/components/responses/NotFoundError",
            },
          },
        },
      },
      "/api/runs/{id}/steer": {
        post: {
          tags: ["Runs"],
          summary: "Steer Running Agent",
          description:
            "Injects user instructions or corrections into the active Pi agent loop during execution.",
          operationId: "steerRun",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SteerRunRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Steer instruction accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", example: true } },
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs/{id}/stop": {
        post: {
          tags: ["Runs"],
          summary: "Stop / Cancel Run",
          description: "Gracefully cancels an active agent execution run.",
          operationId: "stopRun",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Run canceled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", example: true } },
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs/{id}/pr": {
        post: {
          tags: ["Runs"],
          summary: "Create Pull Request",
          description:
            "Pushes verified code from the isolated factory worktree and creates a Pull Request in the target repository.",
          operationId: "createPullRequest",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Pull request created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      prUrl: {
                        type: "string",
                        example: "https://github.com/org/repo/pull/42",
                      },
                      branch: {
                        type: "string",
                        example: "factory/PROJ-101-auth-flow",
                      },
                      status: { type: "string", example: "created" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs/{id}/resume": {
        post: {
          tags: ["Runs"],
          summary: "Resume Run from Recovery Checkpoint",
          description:
            "Manually resumes an execution run from recovery_required status by re-queuing the last active stage safely.",
          operationId: "resumeRun",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Run resumed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      run: { $ref: "#/components/schemas/Run" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs/{id}/abandon": {
        post: {
          tags: ["Runs"],
          summary: "Abandon Run",
          description:
            "Permanently abandons a run in recovery_required status, transitioning it to terminal failed status.",
          operationId: "abandonRun",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Run identifier",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Run abandoned successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      run: { $ref: "#/components/schemas/Run" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/settings": {
        get: {
          tags: ["Settings"],
          summary: "Get Workbench Settings",
          description:
            "Retrieves global factory settings, including model selection, concurrency limits, and masked LLM API keys.",
          operationId: "getSettings",
          responses: {
            "200": {
              description: "Workbench configuration settings",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/FactorySettings",
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Settings"],
          summary: "Update Workbench Settings",
          description:
            "Updates global workbench settings, default review models, and provider API keys.",
          operationId: "updateSettings",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/FactorySettings",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated settings",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/FactorySettings",
                  },
                },
              },
            },
          },
        },
      },
      "/api/providers/manifest": {
        get: {
          tags: ["Providers"],
          summary: "Get Provider Manifest",
          description:
            "Returns registered provider descriptors and config field schemas with optional role filtering.",
          operationId: "getProviderManifest",
          parameters: [
            {
              name: "role",
              in: "query",
              description: "Filter providers and fields by role",
              required: false,
              schema: {
                type: "string",
                enum: ["tracker", "git-host", "gitHost"],
              },
            },
          ],
          responses: {
            "200": {
              description: "Array of provider descriptors",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ProviderDescriptor",
                    },
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
          },
        },
      },
      "/api/providers/verify": {
        post: {
          tags: ["Providers"],
          summary: "Verify Provider Credentials",
          description:
            "Verifies credentials for a selected provider, role, and configuration.",
          operationId: "verifyProvider",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProviderVerifyInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Verification result or normalized provider error envelope",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/VerificationResult" },
                      { $ref: "#/components/schemas/ProviderError" },
                    ],
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
            "409": {
              description:
                "Semantic validation failure (field errors or incompatible role)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ProviderSemanticValidationError",
                  },
                },
              },
            },
          },
        },
      },
      "/api/providers/parse-url": {
        post: {
          tags: ["Providers"],
          summary: "Parse Quick URL",
          description:
            "Parses a provider URL into a configuration draft or returns matched: false.",
          operationId: "parseProviderUrl",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", description: "URL to parse" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Parsed URL configuration draft (matched: true) or unrecognized URL fallback (matched: false)",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/QuickUrlRecognizedResult" },
                      {
                        $ref: "#/components/schemas/QuickUrlUnrecognizedResult",
                      },
                    ],
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
          },
        },
      },
      "/api/providers/repositories": {
        post: {
          tags: ["Providers"],
          summary: "Discover Provider Repositories",
          description:
            "Lists the repositories visible to a git-host connection's credentials. Returns a provider-agnostic envelope, or a normalized ProviderError envelope when the provider call fails. Provider-generated messages are never returned.",
          operationId: "discoverProviderRepositories",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProviderRepositoriesInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Discovered repositories or normalized provider error envelope",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      {
                        $ref: "#/components/schemas/ProviderRepositoriesResult",
                      },
                      { $ref: "#/components/schemas/ProviderError" },
                    ],
                  },
                },
              },
            },
            "400": {
              $ref: "#/components/responses/BadRequestError",
            },
            "409": {
              description:
                "Semantic validation failure (unknown provider, incompatible role, invalid config, or missing discovery capability)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ProviderSemanticValidationError",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      responses: {
        BadRequestError: {
          description: "Invalid request payload or schema failure",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
            },
          },
        },
        NotFoundError: {
          description: "Requested resource not found",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
            },
          },
        },
        InternalError: {
          description: "Persistence or internal failure",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ErrorResponse",
              },
            },
          },
        },
      },
      schemas: {
        HealthResponse: {
          type: "object",
          required: ["status", "uptime", "version"],
          properties: {
            status: { type: "string", example: "ok" },
            uptime: { type: "integer", example: 120 },
            version: { type: "string", example: "0.1.0" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", example: "Resource not found." },
          },
        },
        Repository: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string", example: "frontend-app" },
            path: { type: "string", example: "/Users/dev/code/frontend-app" },
            role: {
              type: "string",
              enum: ["primary", "secondary", "reference"],
              default: "primary",
            },
            branch: { type: "string", example: "main" },
            buildCommand: { type: "string", example: "bun run build" },
            testCommand: { type: "string", example: "bun test" },
            verifyCommand: {
              type: "string",
              example: "bun run lint && bun test",
            },
          },
        },
        ProjectIssueTracker: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: {
              type: "string",
              enum: ["azure", "github", "jira", "local"],
              example: "azure",
            },
            orgUrl: { type: "string", example: "https://dev.azure.com/my-org" },
            project: { type: "string", example: "PlatformEngineering" },
            pat: { type: "string", example: "••••••••" },
            repo: { type: "string", example: "my-repo" },
            host: {
              type: "string",
              example: "https://my-company.atlassian.net",
            },
            email: { type: "string", example: "developer@example.com" },
            projectKey: { type: "string", example: "PROJ" },
            tag: { type: "string", example: "agentic-workflow" },
          },
        },
        FormErrorResponse: {
          type: "object",
          description:
            "Codes only — provider and validation messages never cross the API boundary.",
          properties: {
            formErrors: {
              type: "array",
              items: { type: "string" },
              example: ["INCOMPATIBLE_CONFIGURATION"],
            },
            fieldErrors: {
              type: "object",
              additionalProperties: {
                type: "string",
                enum: ["REQUIRED", "INVALID"],
              },
              example: { apiToken: "REQUIRED" },
            },
          },
        },
        GitIdentity: {
          type: "object",
          required: ["name", "email"],
          description:
            "Project-level git identity. Never nested inside a connection (#131).",
          properties: {
            name: { type: "string", example: "Ada Lovelace" },
            email: {
              type: "string",
              format: "email",
              example: "ada@example.com",
            },
          },
        },
        ProjectConnection: {
          type: "object",
          required: ["providerId", "roles", "config"],
          description:
            "One normalized provider connection (#131). `config` holds the " +
            "provider's non-secret configuration only: declared secret fields are " +
            "stored in per-project environment storage under the provider's `envKey`.",
          properties: {
            providerId: { type: "string", example: "jira" },
            roles: {
              type: "array",
              minItems: 1,
              items: { type: "string", enum: ["tracker", "gitHost"] },
              example: ["tracker"],
            },
            config: {
              type: "object",
              additionalProperties: true,
              example: {
                host: "https://company.atlassian.net",
                email: "dev@example.com",
                project: "PROJ",
              },
            },
          },
        },
        ProjectConnectionInput: {
          type: "object",
          required: ["providerId", "roles", "config"],
          description:
            "A connection as sent by the client. Secret values ride inline in " +
            "`config` exactly once; the server derives which fields are secret from " +
            "the registered provider's schema and never trusts client metadata.",
          properties: {
            providerId: { type: "string", example: "jira" },
            roles: {
              type: "array",
              minItems: 1,
              items: { type: "string", enum: ["tracker", "gitHost"] },
              example: ["tracker"],
            },
            config: {
              type: "object",
              additionalProperties: true,
              description:
                "Provider configuration, including secret values on create/replace.",
              example: {
                host: "https://company.atlassian.net",
                email: "dev@example.com",
                apiToken: "••••••••",
                project: "PROJ",
              },
            },
          },
        },
        ProjectRepositoryInput: {
          type: "object",
          required: ["id", "name"],
          description:
            "A role-tagged repository selected from git-host discovery.",
          properties: {
            id: { type: "string", example: "rocket-web" },
            name: { type: "string", example: "web" },
            remote: {
              type: "string",
              example: "https://github.com/acme/web.git",
            },
            defaultBranch: { type: "string", example: "main" },
            localPath: {
              type: "string",
              example: "/Users/dev/code/web",
            },
            role: {
              type: "string",
              enum: [
                "frontend",
                "backend",
                "service",
                "worker",
                "mobile",
                "infrastructure",
                "documentation",
                "knowledge",
                "other",
              ],
              example: "frontend",
            },
            primary: { type: "boolean", example: true },
          },
        },
        ProjectCreationRequest: {
          type: "object",
          required: ["id", "name", "connections", "repositories"],
          description:
            "The normalized project creation payload (#131). Secrets are written to " +
            "per-project environment storage before the project record is committed.",
          properties: {
            id: { type: "string", example: "my-project" },
            name: { type: "string", example: "My Cool Project" },
            workspacePath: { type: "string", example: "/Users/dev/code" },
            commandTimeoutMs: { type: "integer", example: 600000 },
            gitIdentity: { $ref: "#/components/schemas/GitIdentity" },
            connections: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/ProjectConnectionInput" },
            },
            repositories: {
              type: "array",
              minItems: 1,
              description:
                "Role-tagged repositories; at least one application repository is required.",
              items: { $ref: "#/components/schemas/ProjectRepositoryInput" },
            },
          },
        },
        ProjectConnectionUpdate: {
          type: "object",
          required: ["connections"],
          description:
            "Connection update contract (#131). A missing or empty secret value " +
            "keeps the stored secret; `clearSecrets` removes stored secrets and is " +
            "applied before validation, so clearing a required secret fails with " +
            "`fieldErrors`.",
          properties: {
            name: { type: "string", example: "My Cool Project" },
            workspacePath: { type: "string", example: "/Users/dev/code" },
            gitIdentity: { $ref: "#/components/schemas/GitIdentity" },
            connections: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/ProjectConnectionInput" },
            },
            clearSecrets: {
              type: "array",
              items: { type: "string" },
              example: ["apiToken"],
            },
          },
        },
        ProjectInput: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", example: "my-project" },
            name: { type: "string", example: "My Cool Project" },
            description: {
              type: "string",
              example: "Core engineering workbench project",
            },
            tracker: { $ref: "#/components/schemas/ProjectIssueTracker" },
            workspacePath: { type: "string", example: "/Users/dev/code" },
            gitIdentity: { $ref: "#/components/schemas/GitIdentity" },
            connections: {
              type: "array",
              description:
                "Normalized provider connections (#131). Additive to `tracker`.",
              items: { $ref: "#/components/schemas/ProjectConnection" },
            },
            repositories: {
              type: "array",
              items: { $ref: "#/components/schemas/Repository" },
            },
            archived: { type: "boolean", default: false },
          },
        },
        Project: {
          allOf: [
            { $ref: "#/components/schemas/ProjectInput" },
            {
              type: "object",
              properties: {
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" },
              },
            },
          ],
        },
        ProjectWithReadiness: {
          allOf: [
            { $ref: "#/components/schemas/Project" },
            {
              type: "object",
              properties: {
                readiness: { $ref: "#/components/schemas/ProjectReadiness" },
              },
            },
          ],
        },
        ProjectReadiness: {
          type: "object",
          required: ["ready", "checks"],
          properties: {
            ready: { type: "boolean", example: true },
            checks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  passed: { type: "boolean" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        Ticket: {
          type: "object",
          required: ["id", "title"],
          properties: {
            id: { type: "string", example: "PROJ-102" },
            title: { type: "string", example: "Add user profile settings" },
            description: { type: "string" },
            status: { type: "string", example: "Active" },
            acceptanceCriteria: {
              type: "array",
              items: { type: "string" },
              example: [
                "Profile picture upload works",
                "Theme toggle persists in localStorage",
              ],
            },
            tags: {
              type: "array",
              items: { type: "string" },
              example: ["agentic-workflow", "frontend"],
            },
            url: {
              type: "string",
              example: "https://dev.azure.com/org/proj/_workitems/edit/102",
            },
          },
        },
        DiscoveredRepository: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string", example: "core-service" },
            path: { type: "string", example: "/Users/dev/code/core-service" },
            remoteUrl: {
              type: "string",
              example: "https://github.com/org/core-service.git",
            },
            defaultBranch: { type: "string", example: "main" },
          },
        },
        RepositoryInspectionResult: {
          type: "object",
          properties: {
            packageManager: { type: "string", example: "bun" },
            testRunner: { type: "string", example: "bun test" },
            linter: { type: "string", example: "biome" },
            buildScript: { type: "string", example: "bun run build" },
            hasGit: { type: "boolean", example: true },
            isClean: { type: "boolean", example: true },
            gitIdentity: {
              type: "object",
              description:
                "The git identity in effect for the inspected directory, read with the same git configuration the executor's worktree resolves. ABSENT when either user.name or user.email is unconfigured for it — never an empty string and never a guessed default.",
              properties: {
                name: { type: "string", example: "Dev Example" },
                email: { type: "string", example: "dev@example.com" },
              },
            },
          },
        },
        ConnectionTestResult: {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { type: "boolean", example: true },
            provider: { type: "string", example: "azure" },
            message: {
              type: "string",
              example: "Connected successfully. Found 3 repositories.",
            },
            errors: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        ScopeVerificationResult: {
          type: "object",
          required: ["ok", "scopes"],
          properties: {
            ok: { type: "boolean", example: true },
            scopes: {
              type: "object",
              properties: {
                workItemsRead: { type: "boolean" },
                codeRead: { type: "boolean" },
                codeStatus: { type: "boolean" },
                overPrivileged: { type: "boolean" },
              },
            },
            errors: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        CreateRunRequest: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", example: "x-factory" },
            ticketId: { type: "string", example: "XF-042" },
            ticketTitle: {
              type: "string",
              example: "Integrate Scalar API Reference",
            },
            plan: {
              type: "string",
              example: "Implement OpenAPI route and mount Scalar standalone",
            },
            acceptanceCriteria: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              example: [
                "/api/openapi.json returns valid spec",
                "/reference serves Scalar UI",
              ],
            },
            description: {
              type: "string",
              example: "Documentation task for OpenAPI & Scalar",
            },
            branch: { type: "string", example: "main" },
          },
        },
        SteerRunRequest: {
          type: "object",
          required: ["message"],
          properties: {
            message: {
              type: "string",
              example: "Also include support for /scalar alias",
            },
          },
        },
        RunSummary: {
          type: "object",
          required: ["id", "projectId", "status", "stage"],
          properties: {
            id: { type: "string", example: "run-1710900000000" },
            projectId: { type: "string", example: "x-factory" },
            ticketId: { type: "string", example: "XF-042" },
            ticketTitle: { type: "string", example: "Integrate Scalar" },
            status: {
              type: "string",
              enum: ["queued", "running", "completed", "failed", "stopped"],
              example: "running",
            },
            stage: {
              type: "string",
              enum: [
                "understand",
                "plan",
                "implement",
                "verify",
                "review",
                "deliver",
                "done",
              ],
              example: "implement",
            },
            startTime: { type: "integer", example: 1710900000000 },
            endTime: { type: "integer" },
          },
        },
        Run: {
          allOf: [
            { $ref: "#/components/schemas/RunSummary" },
            {
              type: "object",
              properties: {
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string" },
                      text: { type: "string" },
                      timestamp: { type: "integer" },
                    },
                  },
                },
                prUrl: { type: "string" },
                branch: { type: "string" },
                worktreePath: { type: "string" },
              },
            },
          ],
        },
        FactorySettings: {
          type: "object",
          properties: {
            llmProvider: { type: "string", example: "anthropic" },
            defaultModel: {
              type: "string",
              example: "claude-3-7-sonnet-latest",
            },
            maxConcurrentRuns: { type: "integer", example: 3 },
            anthropicApiKey: { type: "string", example: "••••••••" },
            openaiApiKey: { type: "string", example: "••••••••" },
            geminiApiKey: { type: "string", example: "••••••••" },
          },
        },
        ProviderConfigFieldDescriptor: {
          type: "object",
          required: ["name", "label", "type", "required"],
          properties: {
            name: { type: "string", example: "host" },
            label: { type: "string", example: "Host URL" },
            type: {
              type: "string",
              enum: ["text", "secret", "url", "email"],
              example: "url",
            },
            required: { type: "boolean", example: true },
            secret: { type: "boolean", example: false },
            placeholder: { type: "string", example: "https://example.com" },
            help: { type: "string", example: "Base URL of the provider." },
            roles: {
              type: "array",
              items: { type: "string", enum: ["tracker", "gitHost"] },
            },
          },
        },
        ProviderDescriptor: {
          type: "object",
          required: [
            "id",
            "displayName",
            "roles",
            "iconRef",
            "capabilities",
            "configFields",
          ],
          properties: {
            id: { type: "string", example: "stub" },
            displayName: { type: "string", example: "Stub Provider" },
            roles: {
              type: "array",
              items: { type: "string", enum: ["tracker", "gitHost"] },
            },
            iconRef: { type: "string", example: "provider-stub" },
            capabilities: {
              type: "array",
              items: { type: "string" },
              example: ["verifyScopes", "parseQuickUrl"],
            },
            configFields: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ProviderConfigFieldDescriptor",
              },
            },
          },
        },
        ProviderVerifyInput: {
          type: "object",
          required: ["providerId", "config"],
          properties: {
            providerId: { type: "string", example: "stub" },
            role: {
              type: "string",
              enum: ["tracker", "gitHost", "git-host"],
              example: "tracker",
            },
            config: {
              type: "object",
              additionalProperties: true,
              example: { host: "https://stub.example", apiToken: "token" },
            },
          },
        },
        VerificationWarning: {
          type: "object",
          required: ["kind", "capability"],
          properties: {
            kind: {
              type: "string",
              enum: ["CAPABILITY_UNCONFIRMED"],
              example: "CAPABILITY_UNCONFIRMED",
            },
            capability: { type: "string", example: "verifyScopes" },
          },
        },
        VerificationResult: {
          type: "object",
          required: ["status", "warnings"],
          properties: {
            status: {
              type: "string",
              enum: ["ok", "degraded"],
              example: "ok",
            },
            warnings: {
              type: "array",
              items: {
                $ref: "#/components/schemas/VerificationWarning",
              },
            },
          },
        },
        ProviderError: {
          type: "object",
          required: ["code", "context"],
          properties: {
            code: {
              type: "string",
              enum: [
                "AUTH_INVALID",
                "AUTH_LOCKED",
                "NOT_FOUND",
                "RATE_LIMITED",
                "PERMISSION",
                "UNKNOWN",
              ],
              example: "AUTH_INVALID",
            },
            context: {
              type: "string",
              enum: ["VERIFY", "DISCOVERY", "TICKETS", "PR"],
              example: "VERIFY",
            },
            retryAfterMs: { type: "number", example: 30000 },
          },
        },
        ProviderRepositoriesInput: {
          type: "object",
          required: ["providerId", "config"],
          properties: {
            providerId: { type: "string", example: "stub" },
            role: {
              type: "string",
              enum: ["tracker", "gitHost", "git-host"],
              description:
                "The connection role the repositories are listed under; omitted means role-agnostic discovery.",
              example: "gitHost",
            },
            config: {
              type: "object",
              additionalProperties: true,
              example: { host: "https://stub.example", apiToken: "token" },
            },
          },
        },
        ProviderRepository: {
          type: "object",
          required: ["id", "name", "remote"],
          properties: {
            id: { type: "string", example: "repo-1" },
            name: { type: "string", example: "rocket-app" },
            remote: {
              type: "string",
              example: "https://stub.example/acme/rocket-app.git",
            },
            defaultBranch: { type: "string", example: "main" },
            webUrl: {
              type: "string",
              example: "https://stub.example/acme/rocket-app",
            },
          },
        },
        ProviderRepositoriesResult: {
          type: "object",
          required: ["providerId", "roles", "repositories"],
          properties: {
            providerId: { type: "string", example: "stub" },
            roles: {
              type: "array",
              description:
                "Connection roles the repositories were listed under.",
              items: { type: "string", enum: ["tracker", "gitHost"] },
              example: ["gitHost"],
            },
            repositories: {
              type: "array",
              items: { $ref: "#/components/schemas/ProviderRepository" },
            },
          },
        },
        ProviderSemanticValidationError: {
          type: "object",
          properties: {
            fieldErrors: {
              type: "object",
              additionalProperties: { type: "string" },
              example: { apiToken: "REQUIRED" },
            },
            formErrors: {
              type: "array",
              items: { type: "string" },
              example: ["INCOMPATIBLE_CONFIGURATION"],
            },
          },
        },
        QuickUrlRecognizedResult: {
          type: "object",
          required: ["matched", "providerId", "configDraft"],
          properties: {
            matched: { type: "boolean", enum: [true] },
            providerId: { type: "string", example: "stub" },
            configDraft: {
              type: "object",
              additionalProperties: true,
              example: { host: "https://stub.example", project: "rocket" },
            },
            inferredName: { type: "string", example: "rocket" },
          },
        },
        QuickUrlUnrecognizedResult: {
          type: "object",
          required: ["matched", "url"],
          properties: {
            matched: { type: "boolean", enum: [false] },
            url: { type: "string", example: "https://unrecognized.example" },
          },
        },
      },
    },
  };
}
