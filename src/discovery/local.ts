// src/discovery/local.ts — Local workspace folder repository discovery.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execCommand } from "../proc.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

export class LocalWorkspaceRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "local";

  // fallow-ignore-next-line complexity
  async listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]> {
    const rootPath = (input.workspacePath || "").trim();
    if (!rootPath) {
      throw new Error("Local workspace path is required for local repository discovery.");
    }

    const resolvedRoot = path.resolve(rootPath);
    let entries: string[];
    try {
      entries = await readdir(resolvedRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to read workspace directory at ${resolvedRoot}: ${msg}`);
    }

    const discovered: DiscoveredRepository[] = [];

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const subPath = path.join(resolvedRoot, entry);
      try {
        const s = await stat(subPath);
        if (!s.isDirectory()) continue;

        // Check if git repo
        const gitCheck = await execCommand("git", ["rev-parse", "--git-dir"], { cwd: subPath });
        if (gitCheck.exitCode !== 0) continue;

        // Query remote URL
        const remoteCheck = await execCommand("git", ["config", "--get", "remote.origin.url"], {
          cwd: subPath,
        });
        const remote = remoteCheck.exitCode === 0 ? remoteCheck.stdout.trim() : "";

        // Query branch
        const branchCheck = await execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: subPath,
        });
        const defaultBranch = branchCheck.exitCode === 0 && branchCheck.stdout.trim() !== "HEAD"
          ? branchCheck.stdout.trim()
          : "main";

        discovered.push({
          id: entry,
          name: entry,
          remote,
          defaultBranch,
        });
      } catch {
        // Skip unreadable directories
      }
    }

    return discovered;
  }
}
