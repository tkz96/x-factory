// src/inspection/index.ts — Safe deterministic local repository and project inspection.

import { access, readFile } from "node:fs/promises";
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

export interface RepositoryInspectionResult {
  path: string;
  exists: boolean;
  isGitRepo: boolean;
  remote?: string;
  defaultBranch?: string;
  role?: RepositoryRole;
  detectedCommands: RepositoryCommands;
  detectedTooling: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const ROLE_KEYWORDS: Array<[string[], RepositoryRole]> = [
  [["knowledge", "graph"], "knowledge"],
  [["worker", "consumer", "queue", "job"], "worker"],
  [["infra", "terraform", "k8s", "helm"], "infrastructure"],
  [["doc", "documentation", "wiki"], "documentation"],
  [["mobile", "ios", "android"], "mobile"],
  [["frontend", "web", "ui", "client"], "frontend"],
  [["backend", "api", "server"], "backend"],
  [["service"], "service"],
];

const FRONTEND_DEPS = new Set(["react", "vue", "svelte", "next", "nuxt", "vite"]);
const BACKEND_DEPS = new Set(["express", "fastify", "koa", "hono", "nest"]);

/**
 * Deterministically detect the role of a repository based on name and directory contents.
 */
export function detectRepositoryRole(repoName: string, packageJsonContent?: string): RepositoryRole {
  const lower = repoName.toLowerCase();

  for (const [keywords, role] of ROLE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return role;
    }
  }

  if (packageJsonContent) {
    try {
      const parsed = JSON.parse(packageJsonContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies });
      if (deps.some((d) => FRONTEND_DEPS.has(d))) return "frontend";
      if (deps.some((d) => BACKEND_DEPS.has(d))) return "backend";
    } catch {
      // Ignore parse failure
    }
  }

  return "other";
}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

async function resolvePackageManager(repoPath: string): Promise<{ pm: PackageManager; label: string }> {
  if (
    (await fileExists(path.join(repoPath, "bun.lockb"))) ||
    (await fileExists(path.join(repoPath, "bun.lock")))
  ) {
    return { pm: "bun", label: "Bun" };
  }
  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) return { pm: "pnpm", label: "pnpm" };
  if (await fileExists(path.join(repoPath, "yarn.lock"))) return { pm: "yarn", label: "Yarn" };
  return { pm: "npm", label: "npm" };
}

// fallow-ignore-next-line complexity
async function detectNodeCommands(repoPath: string): Promise<{
  commands: RepositoryCommands;
  tooling: string[];
} | null> {
  const hasPkgJson = await fileExists(path.join(repoPath, "package.json"));
  if (!hasPkgJson) return null;

  const { pm, label } = await resolvePackageManager(repoPath);
  const hasTsConfig = await fileExists(path.join(repoPath, "tsconfig.json"));

  let scripts: Record<string, string> = {};
  try {
    const raw = await readFile(path.join(repoPath, "package.json"), "utf-8");
    scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts || {};
  } catch {
    scripts = {};
  }

  const runPrefix = pm === "yarn" ? "yarn" : `${pm} run`;
  const execPrefix = pm === "bun" ? "bunx" : pm === "pnpm" ? "pnpm exec" : pm === "yarn" ? "yarn" : "npx";

  const commands: RepositoryCommands = {
    test: pm === "bun" ? "bun test" : scripts.test ? `${runPrefix} test` : `${pm} test`,
    typecheck: scripts.typecheck ? `${runPrefix} typecheck` : hasTsConfig ? `${execPrefix} tsc --noEmit` : undefined,
    lint: scripts.lint ? `${runPrefix} lint` : pm === "bun" ? "bunx eslint ." : undefined,
    build: scripts.build ? `${runPrefix} build` : undefined,
  };

  return { commands, tooling: [label, "Node.js"] };
}

/**
 * Deterministically detect build and test commands from repository configuration files.
 */
export async function detectRepositoryCommands(repoPath: string): Promise<{
  commands: RepositoryCommands;
  tooling: string[];
}> {
  const commands: RepositoryCommands = {};
  const tooling: string[] = [];

  const nodeResult = await detectNodeCommands(repoPath);
  if (nodeResult) {
    Object.assign(commands, nodeResult.commands);
    tooling.push(...nodeResult.tooling);
  }

  if (await fileExists(path.join(repoPath, "Gemfile"))) {
    tooling.push("Ruby / Bundler");
    commands.test = commands.test || "bundle exec rspec";
    commands.lint = commands.lint || "bundle exec rubocop";
  }

  if (await fileExists(path.join(repoPath, "Cargo.toml"))) {
    tooling.push("Rust / Cargo");
    commands.test = commands.test || "cargo test";
    commands.lint = commands.lint || "cargo clippy";
    commands.build = commands.build || "cargo build";
  }

  const hasPy = (await fileExists(path.join(repoPath, "pyproject.toml"))) || (await fileExists(path.join(repoPath, "requirements.txt")));
  if (hasPy) {
    tooling.push("Python");
    commands.test = commands.test || "pytest";
    commands.lint = commands.lint || "ruff check";
  }

  if (await fileExists(path.join(repoPath, "go.mod"))) {
    tooling.push("Go");
    commands.test = commands.test || "go test ./...";
    commands.build = commands.build || "go build ./...";
  }

  return { commands, tooling };
}

/**
 * Inspect an existing local checkout for git status, branch, remote, and tooling.
 */
// fallow-ignore-next-line complexity
export async function inspectLocalRepository(
  repoPath: string,
  expectedRemote?: string
): Promise<RepositoryInspectionResult> {
  const resolved = path.resolve(repoPath);
  const exists = await fileExists(resolved);

  if (!exists) {
    return {
      path: resolved,
      exists: false,
      isGitRepo: false,
      detectedCommands: {},
      detectedTooling: [],
    };
  }

  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], { cwd: resolved });
  const isGitRepo = gitCheck.exitCode === 0;

  let remote: string | undefined;
  let defaultBranch: string | undefined;

  if (isGitRepo) {
    const remoteResult = await execCommand("git", ["config", "--get", "remote.origin.url"], {
      cwd: resolved,
    });
    if (remoteResult.exitCode === 0 && remoteResult.stdout.trim()) {
      remote = remoteResult.stdout.trim();
    }

    const branchResult = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: resolved,
    });
    if (branchResult.exitCode === 0 && branchResult.stdout.trim() !== "HEAD") {
      defaultBranch = branchResult.stdout.trim();
    }
  }

  let pkgContent: string | undefined;
  let repoName = path.basename(resolved);

  try {
    pkgContent = await readFile(path.join(resolved, "package.json"), "utf-8");
    const parsed = JSON.parse(pkgContent) as { name?: string };
    if (parsed.name && typeof parsed.name === "string") {
      repoName = parsed.name;
    }
  } catch {
    // optional
  }

  if (remote && (!repoName || repoName.startsWith("xf-") || repoName === "repo")) {
    const remoteBase = path.basename(remote, ".git");
    if (remoteBase) repoName = remoteBase;
  }

  const role = detectRepositoryRole(repoName, pkgContent);
  const { commands, tooling } = await detectRepositoryCommands(resolved);

  return {
    path: resolved,
    exists: true,
    isGitRepo,
    remote: remote || expectedRemote,
    defaultBranch: defaultBranch || "main",
    role,
    detectedCommands: commands,
    detectedTooling: tooling,
  };
}

/**
 * Evaluate the readiness of an individual repository inside a project.
 */
// fallow-ignore-next-line complexity
async function evaluateRepositoryReadiness(
  repo: ProjectRepository
): Promise<RepositoryReadiness> {
  const exists = await fileExists(repo.path);
  if (!exists) {
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

  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], { cwd: repo.path });
  const isGitRepo = gitCheck.exitCode === 0;
  if (!isGitRepo) {
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

  let remoteMatches = true;
  if (repo.remote) {
    const remoteResult = await execCommand("git", ["config", "--get", "remote.origin.url"], {
      cwd: repo.path,
    });
    if (remoteResult.exitCode === 0) {
      const actualRemote = remoteResult.stdout.trim();
      const normalize = (r: string) => r.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
      remoteMatches = !actualRemote || normalize(actualRemote) === normalize(repo.remote);
    }
  }

  const branchResult = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repo.path,
  });
  const branchDetected = branchResult.exitCode === 0 && Boolean(branchResult.stdout.trim());
  const commandsDetected = Boolean(repo.commands?.test);

  const ready = isGitRepo && remoteMatches && branchDetected;

  return {
    repositoryId: repo.id,
    isGitRepo,
    remoteMatches,
    branchDetected,
    commandsDetected,
    existsLocally: true,
    status: ready ? "ready" : "pending_setup",
    message: ready
      ? "Repository checkout is ready."
      : !remoteMatches
      ? "Local Git remote URL does not match configured remote."
      : "Repository requires local setup.",
  };
}

/**
 * Check overall project readiness and validate all configured repositories.
 */
// fallow-ignore-next-line complexity
export async function checkProjectReadiness(project: Project): Promise<ProjectReadiness> {
  const issues: string[] = [];

  if (!project.id || !project.id.trim()) {
    issues.push("Project is missing a valid identifier.");
  }
  if (!project.name || !project.name.trim()) {
    issues.push("Project is missing a display name.");
  }
  if (!project.issueTracker || !project.issueTracker.connectionId) {
    issues.push("Project requires an issue tracker connection.");
  }
  if (!project.repositories || project.repositories.length === 0) {
    issues.push("Project must contain at least one application repository.");
  }

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
        `Knowledge repository directory not found at ${project.knowledgeRepository.path}.`
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
