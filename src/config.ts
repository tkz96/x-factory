// src/config.ts — Configuration loading and validation for X-Factory projects.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Project } from "./types.js";
import { validateRepo } from "./git.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "config", "projects.json");

/**
 * Load and validate projects from projects.json.
 */
export async function loadProjects(configPath: string = DEFAULT_CONFIG_PATH): Promise<Project[]> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read configuration file at ${configPath}: ${message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in configuration file at ${configPath}: ${message}`);
  }

  if (!data || typeof data !== "object" || !Array.isArray((data as { projects: unknown }).projects)) {
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
  configPath?: string
): Promise<Project | null> {
  const projects = await loadProjects(configPath);
  const project = projects.find((p) => p.id === projectId) || null;
  if (project && validateOnDisk) {
    await validateRepo(project.repositoryPath);
  }
  return project;
}

function requireString(obj: Record<string, unknown>, field: string, projectId?: string): string {
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

function validateProject(item: unknown): Project {
  if (!item || typeof item !== "object") {
    throw new Error("Project entry must be an object.");
  }
  const obj = item as Record<string, unknown>;

  const id = requireString(obj, "id");
  const name = requireString(obj, "name", id);
  const repositoryPath = path.resolve(requireString(obj, "repositoryPath", id));
  const defaultBranch = requireString(obj, "defaultBranch", id);
  const testCommand = requireString(obj, "testCommand", id);

  const knowledgePath = optionalString(obj.knowledgeRepositoryPath);
  const typecheckCommand = optionalString(obj.typecheckCommand);
  const lintCommand = optionalString(obj.lintCommand);
  const commandTimeoutMs =
    typeof obj.commandTimeoutMs === "number" && obj.commandTimeoutMs > 0
      ? obj.commandTimeoutMs
      : undefined;

  return {
    id,
    name,
    repositoryPath,
    knowledgeRepositoryPath: knowledgePath ? path.resolve(knowledgePath) : undefined,
    defaultBranch,
    testCommand,
    typecheckCommand,
    lintCommand,
    commandTimeoutMs,
  };
}
