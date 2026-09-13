// src/paths.ts — External runtime state path management for X-Factory.

import { homedir } from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Get the base data directory for X-Factory.
 * Defaults to ~/.x-factory or X_FACTORY_DATA_DIR if set.
 */
function getDataDir(): string {
  return process.env.X_FACTORY_DATA_DIR || path.join(homedir(), ".x-factory");
}

/**
 * Directory where dedicated worktrees for a project live:
 * ~/.x-factory/projects/<projectId>/worktrees/
 */
export function getProjectWorktreesDir(projectId: string): string {
  return path.join(getDataDir(), "projects", projectId, "worktrees");
}

/**
 * Dedicated worktree directory for a specific run:
 * ~/.x-factory/projects/<projectId>/worktrees/<runId>
 */
export function getWorktreePath(projectId: string, runId: string): string {
  return path.join(getProjectWorktreesDir(projectId), runId);
}

/**
 * Directory where durable run artifacts for a project live:
 * ~/.x-factory/projects/<projectId>/runs/
 */
export function getProjectRunsDir(projectId: string): string {
  return path.join(getDataDir(), "projects", projectId, "runs");
}

/**
 * Directory for a specific run's durable artifacts:
 * ~/.x-factory/projects/<projectId>/runs/<runId>/
 */
export function getRunDir(projectId: string, runId: string): string {
  return path.join(getProjectRunsDir(projectId), runId);
}

/**
 * Path to the run marker file (outside the Git worktree):
 * ~/.x-factory/projects/<projectId>/runs/<runId>/.xfactory-run
 */
export function getRunMarkerPath(projectId: string, runId: string): string {
  return path.join(getRunDir(projectId, runId), ".xfactory-run");
}

/**
 * Ensure a directory exists on disk.
 */
export async function ensureDir(dirPath: string): Promise<string> {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}
