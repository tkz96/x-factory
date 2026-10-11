// src/services/repository-path.ts — Resolves where a project's repository
// checkout lives when the project is created (#283).
//
// The wizard inspects the workspace root itself when a repository has no local
// path of its own, so a single-repository project whose root IS the checkout
// must be recorded at the root — not at `<root>/<name>`, a folder that does
// not exist. `~` is expanded so a typed home-relative path is usable by git.

import { existsSync } from "node:fs";
import path from "node:path";
import { expandUserPath } from "../paths.js";

interface ResolveRepositoryPathInput {
  workspacePath?: string | undefined;
  repository: { name: string; localPath?: string | undefined };
  /** How many repositories the project has; only a lone one may be the root. */
  repositoryCount: number;
  /** Filesystem probe, injectable for tests. */
  exists?: (p: string) => boolean;
}

/** Expands a leading `~`; any other path is left for the caller to resolve. */
function expandHome(p: string): string {
  return p.startsWith("~") ? expandUserPath(p) : p;
}

export function resolveRepositoryPath({
  workspacePath,
  repository,
  repositoryCount,
  exists = existsSync,
}: ResolveRepositoryPathInput): string {
  const root = workspacePath?.trim()
    ? path.resolve(expandHome(workspacePath.trim()))
    : undefined;
  const localPath = repository.localPath?.trim();

  if (localPath) {
    const expanded = expandHome(localPath);
    return root ? path.resolve(root, expanded) : path.resolve(expanded);
  }
  if (!root) return path.resolve(repository.name);

  const child = path.join(root, repository.name);
  const rootIsTheCheckout =
    repositoryCount === 1 && !exists(child) && exists(path.join(root, ".git"));
  return rootIsTheCheckout ? root : child;
}
