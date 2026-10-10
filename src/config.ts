// src/config.ts — Configuration loading, migration, and CRUD for X-Factory projects.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectsFileSchema, validateProjectInput } from "./config-schema.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { validateRepo } from "./git.js";
import { getProjectsConfigPath } from "./paths.js";
import {
  type CreationClaimOptions,
  translateClaimError,
  withCreationClaim,
} from "./services/creation-claim.js";
import type { Project, ProjectRepository } from "./types.js";

export { validateProjectInput as validateProject } from "./config-schema.js";

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
  configPath: string = getProjectsConfigPath(),
): Promise<Project[]> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      const empty = `${JSON.stringify({ projects: [] }, null, 2)}\n`;
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, empty, "utf-8");
      return [];
    }
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

  const fileResult = ProjectsFileSchema.safeParse(data);
  if (!fileResult.success) {
    throw new Error(`Configuration file must contain a "projects" array.`);
  }

  const projects: Project[] = [];
  for (const item of fileResult.data.projects) {
    projects.push(validateProjectInput(item));
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
  configPath: string = getProjectsConfigPath(),
): Promise<void> {
  const cleanProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    workspacePath: p.workspacePath,
    issueTracker: p.issueTracker,
    connections: p.connections,
    gitIdentity: p.gitIdentity,
    archived: p.archived,
    archivedAt: p.archivedAt,
    successorId: p.successorId,
    predecessorId: p.predecessorId,
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
    `${JSON.stringify({ projects: cleanProjects }, null, 2)}\n`,
    "utf-8",
  );
}

/**
 * Create a new project. Throws ConflictError if a project with the same ID already exists.
 *
 * Runs inside the exclusive per-project creation claim so legacy creation
 * satisfies the same creation invariant as normalized creation: exactly one
 * winner per project id, serialized against concurrent legacy or normalized
 * creations.
 */
export async function createProject(
  projectInput: unknown,
  configPath: string = getProjectsConfigPath(),
  options: { claim?: CreationClaimOptions } = {},
): Promise<Project> {
  const validated = validateProjectInput(projectInput);

  try {
    return await withCreationClaim(
      validated.id,
      async (claim) => {
        const projects = await loadProjects(configPath);

        const existingIndex = projects.findIndex((p) => p.id === validated.id);
        if (existingIndex >= 0) {
          throw new ConflictError(
            `Project with ID "${validated.id}" already exists.`,
          );
        }

        await claim.assertHeld();
        projects.push(validated);
        await saveProjects(projects, configPath);
        return validated;
      },
      options.claim,
    );
  } catch (err) {
    translateClaimError(err, validated.id);
  }
}

/**
 * Appends an already-validated project record as the commit point of project
 * creation (#145). The caller is responsible for having validated the complete
 * request and for having persisted the project's secrets first: this function
 * performs only the duplicate-id conflict check and the record write.
 */
export async function appendProjectRecord(
  project: Project,
  configPath: string = getProjectsConfigPath(),
): Promise<Project> {
  const projects = await loadProjects(configPath);

  if (projects.some((p) => p.id === project.id)) {
    throw new ConflictError(`Project with ID "${project.id}" already exists.`);
  }

  projects.push(project);
  await saveProjects(projects, configPath);
  return project;
}

/**
 * Save or update an individual project in projects.json.
 */
export async function saveProject(
  projectInput: unknown,
  configPath: string = getProjectsConfigPath(),
): Promise<Project> {
  const validated = validateProjectInput(projectInput);
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
 * Commits a project migration as ONE file write: the archived predecessor and
 * its successor land together, so a reader can never see the old project gone
 * while the new one is still missing (and a crash can never separate them).
 *
 * The successor id is re-checked against the file it is about to write — the
 * same duplicate-id rule `appendProjectRecord` enforces — so a concurrent
 * creation or a second migration cannot overwrite a stored record. A missing
 * predecessor is a `NotFoundError`; an id that already exists, or a predecessor
 * that a concurrent migration has already archived, is a `ConflictError`.
 */
export async function commitProjectMigration(
  archivedPredecessor: Project,
  successor: Project,
  configPath: string = getProjectsConfigPath(),
): Promise<Project> {
  const projects = await loadProjects(configPath);

  const currentPredecessor = projects.find(
    (p) => p.id === archivedPredecessor.id,
  );
  if (!currentPredecessor) {
    throw new NotFoundError(`Project "${archivedPredecessor.id}" not found.`);
  }
  // The creation claim is keyed on the successor id, so two migrations of the
  // same predecessor to different ids hold different claims. The commit itself
  // must refuse a predecessor that is already archived: otherwise the second
  // write would replace the first migration's archive record.
  if (currentPredecessor.archived || currentPredecessor.successorId) {
    throw new ConflictError(
      `Project "${archivedPredecessor.id}" has already been migrated.`,
    );
  }
  if (projects.some((p) => p.id === successor.id)) {
    throw new ConflictError(
      `Project with ID "${successor.id}" already exists.`,
    );
  }

  const next = projects.map((project) =>
    project.id === archivedPredecessor.id ? archivedPredecessor : project,
  );
  next.push(successor);
  await saveProjects(next, configPath);
  return successor;
}

/**
 * Delete a project by ID from projects.json.
 */
export async function deleteProject(
  projectId: string,
  configPath: string = getProjectsConfigPath(),
): Promise<void> {
  const projects = await loadProjects(configPath);
  const filtered = projects.filter((p) => p.id !== projectId);
  if (filtered.length === projects.length) {
    throw new NotFoundError(`Project "${projectId}" not found.`);
  }
  await saveProjects(filtered, configPath);
}
