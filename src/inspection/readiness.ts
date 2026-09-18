// src/inspection/readiness.ts — Local git repository inspection and project readiness assessment.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { execCommand } from "../proc.js";
import type {
  Project,
  ProjectReadiness,
  ProjectRepository,
  RepositoryCommands,
  RepositoryReadiness,
  RepositoryRole,
} from "../types.js";
import {
  detectRepositoryCommands,
  detectRepositoryRole,
  fileExists,
} from "./tooling.js";

interface RepositoryInspectionResult {
  path: string;
  exists: boolean;
  isGitRepo: boolean;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
  role?: RepositoryRole | undefined;
  detectedCommands: RepositoryCommands;
  detectedTooling: string[];
}

async function resolveGitInfo(dir: string): Promise<{
  isGit: boolean;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
}> {
  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], {
    cwd: dir,
  });
  if (gitCheck.exitCode !== 0) {
    return { isGit: false };
  }

  const remoteResult = await execCommand(
    "git",
    ["config", "--get", "remote.origin.url"],
    { cwd: dir },
  );
  const remote =
    remoteResult.exitCode === 0 && remoteResult.stdout.trim()
      ? remoteResult.stdout.trim()
      : undefined;

  const branchResult = await execCommand(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: dir },
  );
  const defaultBranch =
    branchResult.exitCode === 0 && branchResult.stdout.trim() !== "HEAD"
      ? branchResult.stdout.trim()
      : undefined;

  return { isGit: true, remote, defaultBranch };
}

async function resolveRepoPackageName(
  repoPath: string,
  fallbackName: string,
): Promise<{ name: string; content?: string }> {
  try {
    const pkgContent = await readFile(
      path.join(repoPath, "package.json"),
      "utf-8",
    );
    const parsed = JSON.parse(pkgContent) as { name?: string };
    if (parsed.name && typeof parsed.name === "string") {
      return { name: parsed.name, content: pkgContent };
    }
    return { name: fallbackName, content: pkgContent };
  } catch {
    return { name: fallbackName };
  }
}

/**
 * Inspect an existing local checkout for git status, branch, remote, and tooling.
 */
export async function inspectLocalRepository(
  repoPath: string,
  expectedRemote?: string,
): Promise<RepositoryInspectionResult> {
  const resolved = path.resolve(repoPath);
  if (!(await fileExists(resolved))) {
    return {
      path: resolved,
      exists: false,
      isGitRepo: false,
      detectedCommands: {},
      detectedTooling: [],
    };
  }

  const { isGit, remote, defaultBranch } = await resolveGitInfo(resolved);

  let initialName = path.basename(resolved);
  if (
    remote &&
    (!initialName || initialName.startsWith("xf-") || initialName === "repo")
  ) {
    const remoteBase = path.basename(remote, ".git");
    if (remoteBase) initialName = remoteBase;
  }

  const { name: repoName, content: pkgContent } = await resolveRepoPackageName(
    resolved,
    initialName,
  );
  const role = detectRepositoryRole(repoName, pkgContent);
  const { commands, tooling } = await detectRepositoryCommands(resolved);

  return {
    path: resolved,
    exists: true,
    isGitRepo: isGit,
    remote: remote || expectedRemote,
    defaultBranch: defaultBranch || "main",
    role,
    detectedCommands: commands,
    detectedTooling: tooling,
  };
}

export function normalizeGitRemoteUrl(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();

  // Azure DevOps SSH: git@ssh.dev.azure.com:v3/org/project/repo
  const azSsh = trimmed.match(
    /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
  );
  if (azSsh?.[1] && azSsh[2] && azSsh[3]) {
    return `azure:${azSsh[1].toLowerCase()}/${azSsh[2].toLowerCase()}/${azSsh[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  // Azure DevOps HTTPS: https://(user@)?dev.azure.com/org/project/_git/repo
  const azHttps = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azHttps?.[1] && azHttps[2] && azHttps[3]) {
    return `azure:${azHttps[1].toLowerCase()}/${azHttps[2].toLowerCase()}/${azHttps[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  // Azure DevOps VisualStudio: https://(user@)?org.visualstudio.com/project/_git/repo
  const azVs = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azVs?.[1] && azVs[2] && azVs[3]) {
    return `azure:${azVs[1].toLowerCase()}/${azVs[2].toLowerCase()}/${azVs[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  // GitHub: git@github.com:owner/repo or https://github.com/owner/repo
  const ghMatch = trimmed.match(
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:git@)?github\.com:)([^/]+)\/([^/]+)/i,
  );
  if (ghMatch?.[1] && ghMatch[2]) {
    return `github:${ghMatch[1].toLowerCase()}/${ghMatch[2].replace(/\.git$/, "").toLowerCase()}`;
  }

  // Generic fallback: strip protocols, user auth, .git, and trailing slashes
  return trimmed
    .replace(/^(?:https?|ssh|git):\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:/g, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function checkGitRemoteMatch(
  repoPath: string,
  expectedRemote?: string,
): Promise<boolean> {
  if (!expectedRemote) return true;
  const res = await execCommand(
    "git",
    ["config", "--get", "remote.origin.url"],
    { cwd: repoPath },
  );
  if (res.exitCode !== 0) return true;
  const actual = res.stdout.trim();
  if (!actual) return true;
  return (
    normalizeGitRemoteUrl(actual) === normalizeGitRemoteUrl(expectedRemote)
  );
}

function getReadinessOutcome(
  ready: boolean,
  remoteMatches: boolean,
): { status: "ready" | "pending_setup"; message: string } {
  if (ready)
    return { status: "ready", message: "Repository checkout is ready." };
  if (!remoteMatches) {
    return {
      status: "pending_setup",
      message: "Local Git remote URL does not match configured remote.",
    };
  }
  return {
    status: "pending_setup",
    message: "Repository requires local setup.",
  };
}

/**
 * Evaluate the readiness of an individual repository inside a project.
 */
async function evaluateRepositoryReadiness(
  repo: ProjectRepository,
): Promise<RepositoryReadiness> {
  if (!(await fileExists(repo.path))) {
    return {
      repositoryId: repo.id,
      isGitRepo: false,
      remoteMatches: false,
      branchDetected: false,
      commandsDetected: Boolean(repo.commands?.test),
      existsLocally: false,
      status: "pending_setup",
      message: `Local directory not found at ${repo.path}`,
    };
  }

  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], {
    cwd: repo.path,
  });
  if (gitCheck.exitCode !== 0) {
    return {
      repositoryId: repo.id,
      isGitRepo: false,
      remoteMatches: false,
      branchDetected: false,
      commandsDetected: Boolean(repo.commands?.test),
      existsLocally: true,
      status: "error",
      message: "Directory exists but is not a Git repository.",
    };
  }

  const remoteMatches = await checkGitRemoteMatch(repo.path, repo.remote);
  const branchResult = await execCommand(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: repo.path },
  );
  const branchDetected =
    branchResult.exitCode === 0 && Boolean(branchResult.stdout.trim());
  const ready = remoteMatches && branchDetected;
  const outcome = getReadinessOutcome(ready, remoteMatches);

  return {
    repositoryId: repo.id,
    isGitRepo: true,
    remoteMatches,
    branchDetected,
    commandsDetected: Boolean(repo.commands?.test),
    existsLocally: true,
    status: outcome.status,
    message: outcome.message,
  };
}

function validateProjectStructure(project: Project): string[] {
  const issues: string[] = [];
  if (!project.id?.trim())
    issues.push("Project is missing a valid identifier.");
  if (!project.name?.trim()) issues.push("Project is missing a display name.");
  if (!project.issueTracker?.provider && !project.issueTracker?.connectionId)
    issues.push("Project requires an issue tracker connection.");
  if (!project.repositories || project.repositories.length === 0) {
    issues.push("Project must contain at least one application repository.");
  }
  return issues;
}

/**
 * Check overall project readiness and validate all configured repositories.
 */
export async function checkProjectReadiness(
  project: Project,
): Promise<ProjectReadiness> {
  const issues = validateProjectStructure(project);
  const repoReadinessList: RepositoryReadiness[] = [];
  let readyCount = 0;

  for (const repo of project.repositories || []) {
    const readiness = await evaluateRepositoryReadiness(repo);
    repoReadinessList.push(readiness);
    if (readiness.status === "ready") {
      readyCount++;
    } else if (readiness.message) {
      issues.push(`Repository "${repo.name}": ${readiness.message}`);
    }
  }

  let knowledgeReady = true;
  if (project.knowledgeRepository) {
    const kExists = await fileExists(project.knowledgeRepository.path);
    knowledgeReady = kExists;
    if (!kExists) {
      issues.push(
        `Knowledge repository directory not found at ${project.knowledgeRepository.path}.`,
      );
    }
  }

  const isReady =
    issues.length === 0 &&
    readyCount > 0 &&
    readyCount === repoReadinessList.length &&
    knowledgeReady;

  return {
    projectId: project.id,
    ready: isReady,
    readyCount,
    totalCount: repoReadinessList.length,
    repositories: repoReadinessList,
    knowledgeReady,
    issues,
  };
}
