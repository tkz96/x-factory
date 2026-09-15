// src/discovery/local.ts — Local workspace folder repository discovery.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execCommand } from "../proc.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

async function inspectSubdirectoryRepo(
  subPath: string,
  entry: string,
): Promise<DiscoveredRepository | null> {
  try {
    const s = await stat(subPath);
    if (!s.isDirectory()) return null;

    const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], {
      cwd: subPath,
    });
    if (gitCheck.exitCode !== 0) return null;

    const remoteCheck = await execCommand(
      "git",
      ["config", "--get", "remote.origin.url"],
      {
        cwd: subPath,
      },
    );
    const remote = remoteCheck.exitCode === 0 ? remoteCheck.stdout.trim() : "";

    const branchCheck = await execCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: subPath,
      },
    );
    const defaultBranch =
      branchCheck.exitCode === 0 && branchCheck.stdout.trim() !== "HEAD"
        ? branchCheck.stdout.trim()
        : "main";

    return { id: entry, name: entry, remote, defaultBranch };
  } catch {
    return null;
  }
}

export class LocalWorkspaceRepositoryDiscovery
  implements RepositoryDiscoveryProvider
{
  public readonly provider = "local";

  async listRepositories(
    input: RepositoryDiscoveryInput,
  ): Promise<DiscoveredRepository[]> {
    const rootPath = (input.workspacePath || "").trim();
    if (!rootPath) {
      throw new Error(
        "Local workspace path is required for local repository discovery.",
      );
    }

    const resolvedRoot = path.resolve(rootPath);
    let entries: string[];
    try {
      entries = await readdir(resolvedRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Unable to read workspace directory at ${resolvedRoot}: ${msg}`,
      );
    }

    const discovered: DiscoveredRepository[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const repo = await inspectSubdirectoryRepo(
        path.join(resolvedRoot, entry),
        entry,
      );
      if (repo) discovered.push(repo);
    }

    return discovered;
  }
}
