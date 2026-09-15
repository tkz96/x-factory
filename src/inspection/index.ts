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

async function readPackageScripts(pkgPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(pkgPath, "utf-8");
    return (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts || {};
  } catch {
    return {};
  }
}

const EXEC_PREFIX: Record<PackageManager, string> = {
  bun: "bunx",
  pnpm: "pnpm exec",
  yarn: "yarn",
  npm: "npx",
};

function resolveNodeTestCmd(pm: PackageManager, testScript?: string): string {
  if (pm === "bun") return "bun test";
  if (testScript) return pm === "yarn" ? "yarn test" : `${pm} run test`;
  return `${pm} test`;
}

function resolveNodeTypecheckCmd(pm: PackageManager, tcScript?: string, hasTsConfig = false): string | undefined {
  if (tcScript) return pm === "yarn" ? "yarn typecheck" : `${pm} run typecheck`;
  if (hasTsConfig) return `${EXEC_PREFIX[pm]} tsc --noEmit`;
  return undefined;
}

function buildNodeCommands(
  pm: PackageManager,
  scripts: Record<string, string>,
  hasTsConfig: boolean
): RepositoryCommands {
  const runPrefix = pm === "yarn" ? "yarn" : `${pm} run`;
  return {
    test: resolveNodeTestCmd(pm, scripts.test),
    typecheck: resolveNodeTypecheckCmd(pm, scripts.typecheck, hasTsConfig),
    lint: scripts.lint ? `${runPrefix} lint` : pm === "bun" ? "bunx eslint ." : undefined,
    build: scripts.build ? `${runPrefix} build` : undefined,
  };
}

async function detectNodeCommands(repoPath: string): Promise<{
  commands: RepositoryCommands;
  tooling: string[];
} | null> {
  const pkgPath = path.join(repoPath, "package.json");
  if (!(await fileExists(pkgPath))) return null;

  const { pm, label } = await resolvePackageManager(repoPath);
  const hasTsConfig = await fileExists(path.join(repoPath, "tsconfig.json"));
  const scripts = await readPackageScripts(pkgPath);
  const commands = buildNodeCommands(pm, scripts, hasTsConfig);

  return { commands, tooling: [label, "Node.js"] };
}

interface ToolingRule {
  files: string[];
  tooling: string;
  defaults: RepositoryCommands;
}

const TOOLING_RULES: ToolingRule[] = [
  {
    files: ["Gemfile"],
    tooling: "Ruby / Bundler",
    defaults: { test: "bundle exec rspec", lint: "bundle exec rubocop" },
  },
  {
    files: ["Cargo.toml"],
    tooling: "Rust / Cargo",
    defaults: { test: "cargo test", lint: "cargo clippy", build: "cargo build" },
  },
  {
    files: ["pyproject.toml", "requirements.txt"],
    tooling: "Python",
    defaults: { test: "pytest", lint: "ruff check" },
  },
  {
    files: ["go.mod"],
    tooling: "Go",
    defaults: { test: "go test ./...", build: "go build ./..." },
  },
];

async function checkRuleMatch(repoPath: string, files: string[]): Promise<boolean> {
  for (const f of files) {
    if (await fileExists(path.join(repoPath, f))) return true;
  }
  return false;
}

function mergeDefaults(commands: RepositoryCommands, defaults: RepositoryCommands): void {
  for (const [cmdKey, cmdVal] of Object.entries(defaults)) {
    const k = cmdKey as keyof RepositoryCommands;
    if (!commands[k]) commands[k] = cmdVal;
  }
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

  for (const rule of TOOLING_RULES) {
    if (await checkRuleMatch(repoPath, rule.files)) {
      tooling.push(rule.tooling);
      mergeDefaults(commands, rule.defaults);
    }
  }

  return { commands, tooling };
}

async function resolveGitInfo(dir: string): Promise<{ isGit: boolean; remote?: string; defaultBranch?: string }> {
  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], { cwd: dir });
  if (gitCheck.exitCode !== 0) {
    return { isGit: false };
  }

  const remoteResult = await execCommand("git", ["config", "--get", "remote.origin.url"], { cwd: dir });
  const remote = remoteResult.exitCode === 0 && remoteResult.stdout.trim() ? remoteResult.stdout.trim() : undefined;

  const branchResult = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
  const defaultBranch =
    branchResult.exitCode === 0 && branchResult.stdout.trim() !== "HEAD"
      ? branchResult.stdout.trim()
      : undefined;

  return { isGit: true, remote, defaultBranch };
}

async function resolveRepoPackageName(repoPath: string, fallbackName: string): Promise<{ name: string; content?: string }> {
  try {
    const pkgContent = await readFile(path.join(repoPath, "package.json"), "utf-8");
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
  expectedRemote?: string
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
  if (remote && (!initialName || initialName.startsWith("xf-") || initialName === "repo")) {
    const remoteBase = path.basename(remote, ".git");
    if (remoteBase) initialName = remoteBase;
  }

  const { name: repoName, content: pkgContent } = await resolveRepoPackageName(resolved, initialName);
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

async function checkGitRemoteMatch(repoPath: string, expectedRemote?: string): Promise<boolean> {
  if (!expectedRemote) return true;
  const res = await execCommand("git", ["config", "--get", "remote.origin.url"], { cwd: repoPath });
  if (res.exitCode !== 0) return true;
  const actual = res.stdout.trim();
  const normalize = (r: string) => r.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  return !actual || normalize(actual) === normalize(expectedRemote);
}

function getReadinessOutcome(
  ready: boolean,
  remoteMatches: boolean
): { status: "ready" | "pending_setup"; message: string } {
  if (ready) return { status: "ready", message: "Repository checkout is ready." };
  if (!remoteMatches) {
    return { status: "pending_setup", message: "Local Git remote URL does not match configured remote." };
  }
  return { status: "pending_setup", message: "Repository requires local setup." };
}

/**
 * Evaluate the readiness of an individual repository inside a project.
 */
async function evaluateRepositoryReadiness(repo: ProjectRepository): Promise<RepositoryReadiness> {
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

  const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], { cwd: repo.path });
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
  const branchResult = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo.path });
  const branchDetected = branchResult.exitCode === 0 && Boolean(branchResult.stdout.trim());
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
  if (!project.id?.trim()) issues.push("Project is missing a valid identifier.");
  if (!project.name?.trim()) issues.push("Project is missing a display name.");
  if (!project.issueTracker?.connectionId) issues.push("Project requires an issue tracker connection.");
  if (!project.repositories || project.repositories.length === 0) {
    issues.push("Project must contain at least one application repository.");
  }
  return issues;
}

/**
 * Check overall project readiness and validate all configured repositories.
 */
export async function checkProjectReadiness(project: Project): Promise<ProjectReadiness> {
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
      issues.push(`Knowledge repository directory not found at ${project.knowledgeRepository.path}.`);
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
