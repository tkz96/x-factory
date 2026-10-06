// src/config-schema.ts — Zod schemas and inferred types for X-Factory project configuration.

import path from "node:path";
import { z } from "zod/v4";
import type {
  AzureTrackerConfig,
  GitHubTrackerConfig,
  GitIdentity,
  IssueTrackerProvider,
  JiraTrackerConfig,
  KnowledgeRepository,
  Project,
  ProjectConnection,
  ProjectIssueTracker,
  ProjectRepository,
  RepositoryCommands,
  RepositoryRole,
} from "./types.js";

const IssueTrackerInputSchema = z
  .union([
    z.object({
      // The legacy tracker view is a compatibility field, not the provider
      // registry: a non-empty id keeps records created by providers outside
      // the current built-in set loadable (extensibility gate a, #127).
      provider: z.string().min(1).optional(),
      connectionId: z.string().optional(),
      projectId: z.string().optional(),
      orgUrl: z.string().optional(),
      azure: z
        .object({
          orgUrl: z.string(),
          project: z.string(),
          requiredLabel: z.string().optional(),
        })
        .optional(),
      jira: z
        .object({
          host: z.string(),
          email: z.string(),
          project: z.string(),
          requiredLabel: z.string().optional(),
        })
        .optional(),
      github: z
        .object({
          // A legacy record wrote the flat `repo` ("org/repo"). The normalized
          // payload (#131) carries the provider's OWN configuration field
          // names, and `deriveIssueTracker` copies them verbatim, so the view
          // accepts both. Requiring `repo` alone made every project onboarded
          // through the wizard — whose field is `repository` — unloadable
          // (fixed in #148: `loadProjects` threw for the created project).
          repo: z.string().optional(),
          repoOwner: z.string().optional(),
          repository: z.string().optional(),
          requiredLabel: z.string().optional(),
        })
        .optional(),
    }),
    z.null(),
    z.undefined(),
  ])
  .optional();

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

const NonEmptyString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1));

const OptionalTrimmedString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1))
  .optional();

// ---------------------------------------------------------------------------
// RepositoryRole
// ---------------------------------------------------------------------------

const VALID_ROLES = [
  "frontend",
  "backend",
  "service",
  "worker",
  "mobile",
  "infrastructure",
  "documentation",
  "knowledge",
  "other",
] as const satisfies readonly RepositoryRole[];

const RepositoryRoleSchema = z.enum(VALID_ROLES);

// ---------------------------------------------------------------------------
// RepositoryCommands
// ---------------------------------------------------------------------------

const RepositoryCommandsSchema = z
  .object({
    test: OptionalTrimmedString,
    typecheck: OptionalTrimmedString,
    lint: OptionalTrimmedString,
    build: OptionalTrimmedString,
  })
  .optional()
  .transform((c): RepositoryCommands | undefined => {
    if (!c) return undefined;
    const out: RepositoryCommands = {};
    if (c.test) out.test = c.test;
    if (c.typecheck) out.typecheck = c.typecheck;
    if (c.lint) out.lint = c.lint;
    if (c.build) out.build = c.build;
    return Object.keys(out).length > 0 ? out : undefined;
  });

// ---------------------------------------------------------------------------
// ProjectRepository
// ---------------------------------------------------------------------------

const ProjectRepositorySchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    path: NonEmptyString,
    defaultBranch: z
      .string()
      .transform((s) => s.trim() || "main")
      .default("main"),
    remote: OptionalTrimmedString,
    role: RepositoryRoleSchema.optional(),
    commands: z
      .object({
        test: z.string().optional(),
        typecheck: z.string().optional(),
        lint: z.string().optional(),
        build: z.string().optional(),
      })
      .optional(),
  })
  .transform(
    (r): ProjectRepository => ({
      id: r.id,
      name: r.name,
      path: path.resolve(r.path),
      defaultBranch: r.defaultBranch,
      remote: r.remote,
      role: r.role,
      commands: RepositoryCommandsSchema.parse(r.commands),
    }),
  );

// ---------------------------------------------------------------------------
// Modern multi-repository project input
// ---------------------------------------------------------------------------

const ModernProjectInputSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    workspacePath: OptionalTrimmedString,
    commandTimeoutMs: z.number().positive().optional(),
    issueTracker: IssueTrackerInputSchema,
    archived: z.boolean().optional(),
    archivedAt: z.string().optional(),
    successorId: z.string().optional(),
    predecessorId: z.string().optional(),
    repositories: z
      .array(
        z.object({
          id: NonEmptyString,
          name: NonEmptyString,
          path: NonEmptyString,
          defaultBranch: z.string().optional(),
          remote: z.string().optional(),
          role: z.string().optional(),
          commands: z
            .object({
              test: z.string().optional(),
              typecheck: z.string().optional(),
              lint: z.string().optional(),
              build: z.string().optional(),
            })
            .optional(),
        }),
      )
      .min(1),
    knowledgeRepository: z
      .object({
        repositoryId: z.string().optional(),
        path: z.string().min(1),
        type: z.string().optional(),
      })
      .optional(),
    // Accept legacy string path as fallback
    knowledgeRepositoryPath: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Legacy single-repository project input
// ---------------------------------------------------------------------------

const LegacyProjectInputSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    repositoryPath: NonEmptyString,
    workspacePath: OptionalTrimmedString,
    commandTimeoutMs: z.number().positive().optional(),
    issueTracker: IssueTrackerInputSchema,
    archived: z.boolean().optional(),
    archivedAt: z.string().optional(),
    successorId: z.string().optional(),
    predecessorId: z.string().optional(),
    defaultBranch: z.string().optional(),
    testCommand: z.string().optional(),
    typecheckCommand: z.string().optional(),
    lintCommand: z.string().optional(),
    knowledgeRepositoryPath: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Normalized connections payload (#131/#145)
// ---------------------------------------------------------------------------

const ProjectConnectionRoleSchema = z.enum(["tracker", "gitHost"]);

/**
 * One provider connection as it arrives on the wire. `config` carries secret
 * values inline exactly once; the server derives which of them are secret from
 * the registered provider schema and never trusts client metadata.
 */
export const ProjectConnectionInputSchema = z.object({
  providerId: NonEmptyString,
  roles: z
    .array(ProjectConnectionRoleSchema)
    .min(1, "A connection must declare at least one role."),
  config: z.record(z.string(), z.unknown()),
});

/** A role-tagged repository as returned by git-host discovery. */
const DiscoveredRepositoryInputSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  remote: OptionalTrimmedString,
  defaultBranch: OptionalTrimmedString,
  localPath: OptionalTrimmedString,
  role: RepositoryRoleSchema.optional(),
  primary: z.boolean().optional(),
});

/**
 * The normalized creation payload (#131): project-level fields (including the
 * project-level `gitIdentity`), a normalized `connections` array, and
 * role-tagged repositories with at least one application repository.
 */
export const ConnectionsProjectInputSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    workspacePath: OptionalTrimmedString,
    commandTimeoutMs: z.number().positive().optional(),
    archived: z.boolean().optional(),
    gitIdentity: z
      .object({ name: NonEmptyString, email: NonEmptyString })
      .optional(),
    connections: z.array(ProjectConnectionInputSchema).min(1),
    repositories: z.array(DiscoveredRepositoryInputSchema).min(1),
  })
  .passthrough()
  .refine(
    (input) => input.repositories.some((r) => r.role !== "knowledge"),
    "At least one application repository is required.",
  );

export type ProjectConnectionInput = z.infer<
  typeof ProjectConnectionInputSchema
>;
export type ConnectionsProjectInput = z.infer<
  typeof ConnectionsProjectInputSchema
>;

// ---------------------------------------------------------------------------
// Required connection-role coverage (#133)
// ---------------------------------------------------------------------------

/**
 * The roles a project's connection set must cover: every project needs a usable
 * issue tracker AND a usable git host, supplied either as TWO connections (one
 * per role) or as ONE dual-role connection. A set covering only one role is not
 * a project X-Factory can operate, so it is rejected before any write.
 */
export const REQUIRED_CONNECTION_ROLES = ["tracker", "gitHost"] as const;

export type RequiredConnectionRole = (typeof REQUIRED_CONNECTION_ROLES)[number];

/**
 * The `formErrors` code reported for each required role no connection serves.
 * Exported because the LEGACY create path reports the tracker code too: a legacy
 * payload carries no `connections` array, so the coverage rule is applied to it
 * through the tracker identity it names instead (#133 correction 1).
 */
export const MISSING_CONNECTION_ROLE_CODES: Readonly<
  Record<RequiredConnectionRole, string>
> = {
  tracker: "MISSING_TRACKER_CONNECTION",
  gitHost: "MISSING_GIT_HOST_CONNECTION",
};

/**
 * One code per required role the connection set does not cover, in
 * `REQUIRED_CONNECTION_ROLES` order — both codes when both are missing, so the
 * user learns everything at once. Empty when the set is valid.
 *
 * This is a predicate rather than a `.refine` on `ConnectionsProjectInputSchema`
 * on purpose: that schema is one branch of the transport union
 * (`ProjectInputSchema`), so a payload failing it is a 400 — the missing-role
 * payload must reach the semantic layer to be answered with these 409 codes.
 * The rule still has exactly one definition, and this is it.
 */
export function missingConnectionRoleCodes(
  connections: readonly { roles: readonly string[] }[],
): string[] {
  const covered = new Set(connections.flatMap((c) => c.roles));
  return REQUIRED_CONNECTION_ROLES.filter((role) => !covered.has(role)).map(
    (role) => MISSING_CONNECTION_ROLE_CODES[role],
  );
}

export const ProjectInputSchema = z.union([
  ModernProjectInputSchema,
  LegacyProjectInputSchema,
  ConnectionsProjectInputSchema,
]);

/**
 * The union's own discriminator (#131): a payload that satisfies the normalized
 * connections branch IS the connections payload. Declared next to the union it
 * discriminates so the create path never hand-rolls a second, duck-typed check.
 */
export function isConnectionsProjectInput(
  input: unknown,
): input is ConnectionsProjectInput {
  return ConnectionsProjectInputSchema.safeParse(input).success;
}

// ---------------------------------------------------------------------------
// Unified project validator: handles both legacy and modern formats
// ---------------------------------------------------------------------------

export function validateProjectInput(input: unknown): Project {
  if (!input || typeof input !== "object") {
    throw new Error("Project entry must be an object.");
  }
  const obj = input as Record<string, unknown>;

  // Detect legacy: has repositoryPath but no repositories array
  const isLegacy =
    typeof obj.repositoryPath === "string" &&
    (!obj.repositories || !Array.isArray(obj.repositories));

  if (isLegacy) {
    return _parseLegacy(obj);
  }
  return _parseModern(obj);
}

function _formatConfigError(error: z.ZodError): string {
  const parts: string[] = [];
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "id") {
      parts.push(`missing required string "id"`);
    } else if (field === "name") {
      parts.push(`missing required string "name"`);
    } else if (
      field === "repositories" &&
      (issue.code === "too_small" || issue.path.length === 1)
    ) {
      parts.push(`must contain at least one repository`);
    }
  }
  const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Project configuration invalid${summary}:\n${z.prettifyError(error)}`;
}

function _parseLegacy(obj: Record<string, unknown>): Project {
  const result = LegacyProjectInputSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(_formatConfigError(result.error));
  }
  const d = result.data;

  const commands: RepositoryCommands = {};
  const testCmd = d.testCommand?.trim();
  const typecheckCmd = d.typecheckCommand?.trim();
  const lintCmd = d.lintCommand?.trim();
  if (testCmd) commands.test = testCmd;
  if (typecheckCmd) commands.typecheck = typecheckCmd;
  if (lintCmd) commands.lint = lintCmd;

  const repoPath = path.resolve(d.repositoryPath);
  const defaultBranch = d.defaultBranch?.trim() || "main";

  const repository: ProjectRepository = {
    id: `${d.id}-primary`,
    name: d.name,
    path: repoPath,
    defaultBranch,
    role: "other",
    commands: Object.keys(commands).length > 0 ? commands : undefined,
  };

  let knowledgeRepository: KnowledgeRepository | undefined;
  const kPath = d.knowledgeRepositoryPath?.trim();
  if (kPath) {
    knowledgeRepository = {
      repositoryId: `${d.id}-knowledge`,
      path: path.resolve(kPath),
      type: "graphify",
    };
  }

  const issueTracker = _parseIssueTracker(d.issueTracker, d.id);

  return {
    id: d.id,
    name: d.name,
    workspacePath: d.workspacePath,
    commandTimeoutMs: d.commandTimeoutMs,
    issueTracker,
    repositories: [repository],
    knowledgeRepository,
    repositoryPath: repoPath,
    defaultBranch,
    testCommand: testCmd || "",
    typecheckCommand: typecheckCmd,
    lintCommand: lintCmd,
    knowledgeRepositoryPath: knowledgeRepository?.path,
  };
}

/**
 * Reads stored normalized connections (#131) off a project record. Secret
 * values never appear here — only the provider's non-secret configuration.
 */
function parseStoredConnections(
  obj: Record<string, unknown>,
): ProjectConnection[] | undefined {
  if (!Array.isArray(obj.connections)) return undefined;
  const connections: ProjectConnection[] = [];
  for (const [idx, raw] of obj.connections.entries()) {
    const result = ProjectConnectionInputSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Project connection[${idx}] invalid:\n${z.prettifyError(result.error)}`,
      );
    }
    connections.push({
      providerId: result.data.providerId,
      roles: [...result.data.roles],
      config: result.data.config,
    });
  }
  return connections;
}

/** Reads the project-level git identity off a project record. */
function parseStoredGitIdentity(
  obj: Record<string, unknown>,
): GitIdentity | undefined {
  const raw = obj.gitIdentity;
  if (!raw || typeof raw !== "object") return undefined;
  const { name, email } = raw as Record<string, unknown>;
  if (typeof name !== "string" || typeof email !== "string") return undefined;
  return { name: name.trim(), email: email.trim() };
}

function _parseModern(obj: Record<string, unknown>): Project {
  const result = ModernProjectInputSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(_formatConfigError(result.error));
  }
  const d = result.data;
  // Parse repositories
  const repositories: ProjectRepository[] = d.repositories.map((r, idx) => {
    const parsed = ProjectRepositorySchema.safeParse(r);
    if (!parsed.success) {
      throw new Error(
        `Project "${d.id}" repository[${idx}] invalid:\n${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  });

  // Parse knowledge repository
  let knowledgeRepository: KnowledgeRepository | undefined;
  if (d.knowledgeRepository?.path) {
    knowledgeRepository = {
      repositoryId:
        d.knowledgeRepository.repositoryId?.trim() || `${d.id}-knowledge`,
      path: path.resolve(d.knowledgeRepository.path),
      type: "graphify",
    };
  } else if (d.knowledgeRepositoryPath?.trim()) {
    knowledgeRepository = {
      repositoryId: `${d.id}-knowledge`,
      path: path.resolve(d.knowledgeRepositoryPath.trim()),
      type: "graphify",
    };
  }

  const issueTracker = _parseIssueTracker(d.issueTracker, d.id);

  const primary = repositories[0];
  if (!primary) {
    throw new Error(`Project "${d.id}" must define at least one repository.`);
  }

  return {
    id: d.id,
    name: d.name,
    workspacePath: d.workspacePath,
    commandTimeoutMs: d.commandTimeoutMs,
    issueTracker,
    connections: parseStoredConnections(obj),
    gitIdentity: parseStoredGitIdentity(obj),
    archived:
      typeof (d as Record<string, unknown>).archived === "boolean"
        ? ((d as Record<string, unknown>).archived as boolean)
        : undefined,
    archivedAt:
      typeof (d as Record<string, unknown>).archivedAt === "string"
        ? ((d as Record<string, unknown>).archivedAt as string)
        : undefined,
    successorId:
      typeof (d as Record<string, unknown>).successorId === "string"
        ? ((d as Record<string, unknown>).successorId as string)
        : undefined,
    predecessorId:
      typeof (d as Record<string, unknown>).predecessorId === "string"
        ? ((d as Record<string, unknown>).predecessorId as string)
        : undefined,
    repositories,
    knowledgeRepository,
    repositoryPath: primary.path,
    defaultBranch: primary.defaultBranch,
    testCommand: primary.commands?.test || "",
    typecheckCommand: primary.commands?.typecheck,
    lintCommand: primary.commands?.lint,
    knowledgeRepositoryPath: knowledgeRepository?.path,
  };
}

function parseAzureTrackerConfig(
  t: Record<string, unknown>,
): AzureTrackerConfig | undefined {
  if (t.azure && typeof t.azure === "object") {
    const a = t.azure as Record<string, unknown>;
    return {
      orgUrl: typeof a.orgUrl === "string" ? a.orgUrl.trim() : "",
      project: typeof a.project === "string" ? a.project.trim() : "",
      requiredLabel:
        typeof a.requiredLabel === "string" && a.requiredLabel.trim()
          ? a.requiredLabel.trim()
          : undefined,
    };
  }
  if (
    typeof t.orgUrl === "string" &&
    t.orgUrl.trim() &&
    typeof t.projectId === "string" &&
    t.projectId.trim()
  ) {
    return {
      orgUrl: t.orgUrl.trim(),
      project: t.projectId.trim(),
    };
  }
  return undefined;
}

function parseJiraTrackerConfig(
  t: Record<string, unknown>,
): JiraTrackerConfig | undefined {
  if (t.jira && typeof t.jira === "object") {
    const j = t.jira as Record<string, unknown>;
    return {
      host: typeof j.host === "string" ? j.host.trim() : "",
      email: typeof j.email === "string" ? j.email.trim() : "",
      project: typeof j.project === "string" ? j.project.trim() : "",
      requiredLabel:
        typeof j.requiredLabel === "string" && j.requiredLabel.trim()
          ? j.requiredLabel.trim()
          : undefined,
    };
  }
  return undefined;
}

function parseGitHubTrackerConfig(
  t: Record<string, unknown>,
): GitHubTrackerConfig | undefined {
  if (t.github && typeof t.github === "object") {
    const g = t.github as Record<string, unknown>;
    return {
      repo: typeof g.repo === "string" ? g.repo.trim() : "",
      requiredLabel:
        typeof g.requiredLabel === "string" && g.requiredLabel.trim()
          ? g.requiredLabel.trim()
          : undefined,
    };
  }
  return undefined;
}

function _parseIssueTracker(
  raw: unknown,
  _projectId: string,
): ProjectIssueTracker {
  if (!raw || typeof raw !== "object") {
    return { provider: "github", connectionId: "github" };
  }
  const t = raw as Record<string, unknown>;
  const provider = ((typeof t.provider === "string" && t.provider.trim()
    ? t.provider.trim()
    : "") ||
    (typeof t.connectionId === "string" && t.connectionId.trim()
      ? t.connectionId.trim()
      : "") ||
    "github") as IssueTrackerProvider;

  const result: ProjectIssueTracker = {
    provider,
    connectionId: provider,
    projectId:
      typeof t.projectId === "string" && t.projectId.trim()
        ? t.projectId.trim()
        : undefined,
  };

  const azure = parseAzureTrackerConfig(t);
  if (azure) result.azure = azure;

  const jira = parseJiraTrackerConfig(t);
  if (jira) result.jira = jira;

  const github = parseGitHubTrackerConfig(t);
  if (github) result.github = github;

  return result;
}

// ---------------------------------------------------------------------------
// Projects file schema (top-level { projects: [...] })
// ---------------------------------------------------------------------------

export const ProjectsFileSchema = z.object({
  projects: z.array(z.unknown()),
});
