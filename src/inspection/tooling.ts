// src/inspection/tooling.ts — Language, framework, and tooling detection heuristics.

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositoryCommands, RepositoryRole } from "../types.js";

export async function fileExists(filePath: string): Promise<boolean> {
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

const FRONTEND_DEPS = new Set([
  "react",
  "vue",
  "svelte",
  "next",
  "nuxt",
  "vite",
]);
const BACKEND_DEPS = new Set(["express", "fastify", "koa", "hono", "nest"]);

/**
 * Deterministically detect the role of a repository based on name and directory contents.
 */
export function detectRepositoryRole(
  repoName: string,
  packageJsonContent?: string,
): RepositoryRole {
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
      const deps = Object.keys({
        ...parsed.dependencies,
        ...parsed.devDependencies,
      });
      if (deps.some((d) => FRONTEND_DEPS.has(d))) return "frontend";
      if (deps.some((d) => BACKEND_DEPS.has(d))) return "backend";
    } catch {
      // Ignore parse failure
    }
  }

  return "other";
}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

async function resolvePackageManager(
  repoPath: string,
): Promise<{ pm: PackageManager; label: string }> {
  if (
    (await fileExists(path.join(repoPath, "bun.lockb"))) ||
    (await fileExists(path.join(repoPath, "bun.lock")))
  ) {
    return { pm: "bun", label: "Bun" };
  }
  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml")))
    return { pm: "pnpm", label: "pnpm" };
  if (await fileExists(path.join(repoPath, "yarn.lock")))
    return { pm: "yarn", label: "Yarn" };
  return { pm: "npm", label: "npm" };
}

async function readPackageScripts(
  pkgPath: string,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(pkgPath, "utf-8");
    return (
      (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts || {}
    );
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

function resolveNodeTypecheckCmd(
  pm: PackageManager,
  tcScript?: string,
  hasTsConfig = false,
): string | undefined {
  if (tcScript) return pm === "yarn" ? "yarn typecheck" : `${pm} run typecheck`;
  if (hasTsConfig) return `${EXEC_PREFIX[pm]} tsc --noEmit`;
  return undefined;
}

function buildNodeCommands(
  pm: PackageManager,
  scripts: Record<string, string>,
  hasTsConfig: boolean,
): RepositoryCommands {
  const runPrefix = pm === "yarn" ? "yarn" : `${pm} run`;
  return {
    test: resolveNodeTestCmd(pm, scripts.test),
    typecheck: resolveNodeTypecheckCmd(pm, scripts.typecheck, hasTsConfig),
    lint: scripts.lint
      ? `${runPrefix} lint`
      : pm === "bun"
        ? "bunx eslint ."
        : undefined,
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
    defaults: {
      test: "cargo test",
      lint: "cargo clippy",
      build: "cargo build",
    },
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

async function checkRuleMatch(
  repoPath: string,
  files: string[],
): Promise<boolean> {
  for (const f of files) {
    if (await fileExists(path.join(repoPath, f))) return true;
  }
  return false;
}

function mergeDefaults(
  commands: RepositoryCommands,
  defaults: RepositoryCommands,
): void {
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
