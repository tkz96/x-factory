// src/config.ts — Configuration loading, migration, and CRUD for X-Factory projects.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectsFileSchema, validateProjectInput } from "./config-schema.js";
import { validateRepo } from "./git.js";
import type { Project, ProjectRepository } from "./types.js";

export { validateProjectInput as validateProject } from "./config-schema.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "config", "projects.json");

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
