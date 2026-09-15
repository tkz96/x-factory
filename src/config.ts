// src/config.ts — Configuration loading, migration, and validation for X-Factory projects.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateRepo } from "./git.js";
import type {
  KnowledgeRepository,
  Project,
  ProjectIssueTracker,
  ProjectRepository,
  RepositoryCommands,
  RepositoryRole,
} from "./types.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "config", "projects.json");

const VALID_ROLES = new Set<RepositoryRole>([
  "frontend",
  "backend",
  "service",
  "worker",
  "mobile",
  "infrastructure",
  "documentation",
  "knowledge",
  "other",
]);

/**
 * Return the primary repository of a project (first application repository).
 */
export function getPrimaryRepository(project: Project): ProjectRepository {
  const primary = project.repositories[0];
  if (!primary) {
    throw new Error(`Project "${project.id}" has no configured repositories.`);
  }
  return primary;
}

/**
 * Load and validate projects from projects.json.
 * Automatically migrates legacy single-repository entries.
 */
export async function loadProjects(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<Project[]> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read configuration file at ${configPath}: ${message}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid JSON in configuration file at ${configPath}: ${message}`,
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { projects: unknown }).projects)
  ) {
    throw new Error(`Configuration file must contain a "projects" array.`);
  }

  const projectsRaw = (data as { projects: unknown[] }).projects;
  const projects: Project[] = [];

  for (const item of projectsRaw) {
    const p = validateProject(item);
    projects.push(p);
  }

  return projects;
}

/**
 * Find a single project by id and optionally validate that its repository is accessible.
 */
export async function getProject(
  projectId: string,
  validateOnDisk = false,
  configPath?: string,
): Promise<Project | null> {
  const projects = await loadProjects(configPath);
  const project = projects.find((p) => p.id === projectId) || null;
  if (project && validateOnDisk) {
    const primary = getPrimaryRepository(project);
    await validateRepo(primary.path);
  }
  return project;
}

/**
 * Save all projects to the configuration file with standard formatting.
 */
async function saveProjects(
  projects: Project[],
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  const cleanProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    workspacePath: p.workspacePath,
    issueTracker: p.issueTracker,
    repositories: p.repositories.map((r) => ({
      id: r.id,
      name: r.name,
      remote: r.remote,
      path: r.path,
      defaultBranch: r.defaultBranch,
      role: r.role,
      commands: r.commands,
    })),
    knowledgeRepository: p.knowledgeRepository
      ? {
          repositoryId: p.knowledgeRepository.repositoryId,
          path: p.knowledgeRepository.path,
          type: p.knowledgeRepository.type,
        }
      : undefined,
    commandTimeoutMs: p.commandTimeoutMs,
  }));

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ projects: cleanProjects }, null, 2),
    "utf-8",
  );
}

/**
 * Save or update an individual project in projects.json.
 */
export async function saveProject(
  projectInput: unknown,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<Project> {
  const validated = validateProject(projectInput);
  let projects: Project[] = [];
  try {
    projects = await loadProjects(configPath);
  } catch {
    projects = [];
  }

  const existingIndex = projects.findIndex((p) => p.id === validated.id);
  if (existingIndex >= 0) {
    projects[existingIndex] = validated;
  } else {
    projects.push(validated);
  }

  await saveProjects(projects, configPath);
  return validated;
}

/**
 * Delete a project by ID from projects.json.
 */
export async function deleteProject(
  projectId: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  const projects = await loadProjects(configPath);
  const filtered = projects.filter((p) => p.id !== projectId);
  if (filtered.length === projects.length) {
    throw new Error(`Project "${projectId}" not found.`);
  }
  await saveProjects(filtered, configPath);
}

function requireString(
  obj: Record<string, unknown>,
  field: string,
  projectId?: string,
): string {
  const val = obj[field];
  if (typeof val !== "string" || !val.trim()) {
    const prefix = projectId ? `Project "${projectId}"` : "Project";
    throw new Error(`${prefix} missing required string "${field}".`);
  }
  return val.trim();
}

function optionalString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

function validateCommands(raw: unknown): RepositoryCommands | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const commands: RepositoryCommands = {};
  for (const k of ["test", "typecheck", "lint", "build"] as const) {
    const val = optionalString(c[k]);
    if (val) commands[k] = val;
  }
  return Object.keys(commands).length > 0 ? commands : undefined;
}

function validateRepository(
  raw: unknown,
  projectId: string,
  index: number,
): ProjectRepository {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Project "${projectId}" repository at index ${index} must be an object.`,
    );
  }
  const r = raw as Record<string, unknown>;
  const id = requireString(r, "id", projectId);
  const name = requireString(r, "name", projectId);
  const rawPath = requireString(r, "path", projectId);
  const resolvedPath = path.resolve(rawPath);
  const defaultBranch = optionalString(r.defaultBranch) || "main";
  const remote = optionalString(r.remote);

  let role: RepositoryRole | undefined;
  if (typeof r.role === "string" && VALID_ROLES.has(r.role as RepositoryRole)) {
    role = r.role as RepositoryRole;
  }

  const commands = validateCommands(r.commands);

  return {
    id,
    name,
    path: resolvedPath,
    defaultBranch,
    remote,
    role,
    commands,
  };
}

function validateIssueTracker(raw: unknown): ProjectIssueTracker {
  if (!raw || typeof raw !== "object") {
    return { connectionId: "github" };
  }
  const t = raw as Record<string, unknown>;
  const connectionId = optionalString(t.connectionId) || "github";
  const trackerProjectId = optionalString(t.projectId);
  return {
    connectionId,
    projectId: trackerProjectId,
  };
}

function validateKnowledgeRepository(
  raw: unknown,
  projectId: string,
): KnowledgeRepository | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const k = raw as Record<string, unknown>;
  const rawPath = optionalString(k.path);
  if (!rawPath) return undefined;

  const repositoryId =
    optionalString(k.repositoryId) || `${projectId}-knowledge`;
  return {
    repositoryId,
    path: path.resolve(rawPath),
    type: "graphify",
  };
}

function normalizeLegacyProject(
  obj: Record<string, unknown>,
  id: string,
  name: string,
): {
  repositories: ProjectRepository[];
  issueTracker: ProjectIssueTracker;
  knowledgeRepository?: KnowledgeRepository | undefined;
} {
  const legacyPath = path.resolve(requireString(obj, "repositoryPath", id));
  const legacyBranch = optionalString(obj.defaultBranch) || "main";
  const legacyTest = optionalString(obj.testCommand);
  const legacyTypecheck = optionalString(obj.typecheckCommand);
  const legacyLint = optionalString(obj.lintCommand);

  const commands: RepositoryCommands = {};
  if (legacyTest) commands.test = legacyTest;
  if (legacyTypecheck) commands.typecheck = legacyTypecheck;
  if (legacyLint) commands.lint = legacyLint;

  const repositories: ProjectRepository[] = [
    {
      id: `${id}-primary`,
      name,
      path: legacyPath,
      defaultBranch: legacyBranch,
      role: "other",
      commands: Object.keys(commands).length > 0 ? commands : undefined,
    },
  ];

  const issueTracker = validateIssueTracker(obj.issueTracker);

  let knowledgeRepository: KnowledgeRepository | undefined;
  const legacyKnowledgePath = optionalString(obj.knowledgeRepositoryPath);
  if (legacyKnowledgePath) {
    knowledgeRepository = {
      repositoryId: `${id}-knowledge`,
      path: path.resolve(legacyKnowledgePath),
      type: "graphify",
    };
  }

  return { repositories, issueTracker, knowledgeRepository };
}

function validateModernProject(
  obj: Record<string, unknown>,
  id: string,
): {
  repositories: ProjectRepository[];
  issueTracker: ProjectIssueTracker;
  knowledgeRepository?: KnowledgeRepository | undefined;
} {
  if (!Array.isArray(obj.repositories) || obj.repositories.length === 0) {
    throw new Error(`Project "${id}" must contain at least one repository.`);
  }

  const repositories = obj.repositories.map((repo, idx) =>
    validateRepository(repo, id, idx),
  );
  const issueTracker = validateIssueTracker(obj.issueTracker);
  let knowledgeRepository = validateKnowledgeRepository(
    obj.knowledgeRepository,
    id,
  );

  // Fallback: if knowledgeRepositoryPath was provided as string
  if (!knowledgeRepository && optionalString(obj.knowledgeRepositoryPath)) {
    knowledgeRepository = {
      repositoryId: `${id}-knowledge`,
      path: path.resolve(String(obj.knowledgeRepositoryPath)),
      type: "graphify",
    };
  }

  return { repositories, issueTracker, knowledgeRepository };
}

/**
 * Validate and normalize a Project object.
 * Handles migration from legacy single-repository schema if present.
 */
export function validateProject(item: unknown): Project {
  if (!item || typeof item !== "object") {
    throw new Error("Project entry must be an object.");
  }
  const obj = item as Record<string, unknown>;

  const id = requireString(obj, "id");
  const name = requireString(obj, "name", id);
  const workspacePath = optionalString(obj.workspacePath)
    ? path.resolve(String(obj.workspacePath))
    : undefined;

  const commandTimeoutMs =
    typeof obj.commandTimeoutMs === "number" && obj.commandTimeoutMs > 0
      ? obj.commandTimeoutMs
      : undefined;

  const isLegacy =
    typeof obj.repositoryPath === "string" &&
    (!obj.repositories || !Array.isArray(obj.repositories));

  const { repositories, issueTracker, knowledgeRepository } = isLegacy
    ? normalizeLegacyProject(obj, id, name)
    : validateModernProject(obj, id);

  // Ensure primary repository exists
  const primary = repositories[0];
  if (!primary) {
    throw new Error(`Project "${id}" must define at least one repository.`);
  }

  return {
    id,
    name,
    workspacePath,
    issueTracker,
    repositories,
    knowledgeRepository,
    commandTimeoutMs,

    // Backwards-compatibility convenience fields
    repositoryPath: primary.path,
    defaultBranch: primary.defaultBranch,
    testCommand: primary.commands?.test || "",
    typecheckCommand: primary.commands?.typecheck,
    lintCommand: primary.commands?.lint,
    knowledgeRepositoryPath: knowledgeRepository?.path,
  };
}
