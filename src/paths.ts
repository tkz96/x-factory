// src/paths.ts — External runtime state path management for X-Factory.

import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Expand a user path starting with ~ into an absolute path, or resolve a relative path.
 */
export function expandUserPath(inputPath: string): string {
  return inputPath.startsWith("~")
    ? path.join(homedir(), inputPath.slice(1))
    : path.resolve(inputPath);
}

/**
 * Scan immediate subdirectories of a parent directory and return names of directories containing a .git folder or file.
 */
export async function scanGitSubdirectories(
  parentDir: string,
): Promise<string[]> {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const repos: string[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const dotGit = await stat(path.join(parentDir, ent.name, ".git"));
        if (dotGit.isDirectory() || dotGit.isFile()) repos.push(ent.name);
      } catch {
        // ignore non-git subdirectories
      }
    }
    return repos;
  } catch {
    return [];
  }
}

export function getDataDir(): string {
  return process.env.X_FACTORY_DATA_DIR || path.join(homedir(), ".x-factory");
}

/**
 * Get the SQLite database file path.
 * Defaults to ~/.x-factory/x-factory.db or X_FACTORY_DB_PATH if set.
 */
export function getDatabasePath(): string {
  return (
    process.env.X_FACTORY_DB_PATH || path.join(getDataDir(), "x-factory.db")
  );
}

/**
 * Directory for a project's data:
 * ~/.x-factory/projects/<projectId>/
 */
export function getProjectDir(projectId: string): string {
  return path.join(getDataDir(), "projects", projectId);
}

/**
 * Path to project-level .env secrets file:
 * ~/.x-factory/projects/<projectId>/.env
 */
export function getProjectEnvPath(projectId: string): string {
  return path.join(getProjectDir(projectId), ".env");
}

/**
 * Directory where dedicated worktrees for a project live:
 * ~/.x-factory/projects/<projectId>/worktrees/
 */
export function getProjectWorktreesDir(projectId: string): string {
  return path.join(getProjectDir(projectId), "worktrees");
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
