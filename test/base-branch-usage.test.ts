// test/base-branch-usage.test.ts — a repository's chosen base branch (here
// "develop", not "main") is the branch new work starts from and the target of
// the pull request.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultCreatePullRequest } from "../src/executors/deliver.js";
import { prepareBranch } from "../src/executors/prepare.js";
import * as git from "../src/git.js";
import type {
  CreatePullRequestInput,
  Provider,
} from "../src/providers/contract.js";
import { githubConfigSchema } from "../src/providers/github/config.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import type { Project } from "../src/shared/types.js";

let tempDir: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-base-branch-"));
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
});
afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  await rm(tempDir, { recursive: true, force: true });
});

const baseProject = (repositoryPath: string): Project => ({
  id: "proj-base-branch",
  name: "Web",
  issueTracker: { provider: "jira", connectionId: "jira" } as never,
  connections: [
    {
      providerId: "stubhost",
      roles: ["gitHost"],
      config: { repoOwner: "acme", repository: "web" },
    },
  ],
  repositories: [],
  repositoryPath,
  defaultBranch: "develop",
  testCommand: "test",
});

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

describe("a non-main base branch", () => {
  it("is the target of the pull request", async () => {
    let received: CreatePullRequestInput | undefined;
    const host: Provider = {
      id: "stubhost",
      displayName: "Stub host",
      roles: ["gitHost"],
      iconRef: "provider-github",
      configSchema: githubConfigSchema,
      async verifyCredentials() {
        return { status: "ok", warnings: [] };
      },
      toUserError: (_r, context) => ({ code: "AUTH_INVALID", context }),
      async createPullRequest(_config, input) {
        received = input;
        return { url: "https://stub/pr/1" } as never;
      },
    };
    const registry: ProviderRegistry = new Map([["stubhost", host]]);
    await defaultCreatePullRequest(
      baseProject("/mock"),
      { branch: "factory/E-1", worktree: "/mock", prTitle: "t", prBody: "b" },
      registry,
    );
    expect(received?.targetBranch).toBe("develop");
  });

  it("is the commit the run branch starts from", async () => {
    const repo = path.join(tempDir, "repo");
    await Bun.$`git init -q -b main ${repo}`;
    await sh(repo, "config", "user.email", "t@example.com");
    await sh(repo, "config", "user.name", "t");
    await sh(repo, "commit", "-q", "--allow-empty", "-m", "on main");
    await sh(repo, "checkout", "-q", "-b", "develop");
    await sh(repo, "commit", "-q", "--allow-empty", "-m", "on develop");
    await sh(repo, "checkout", "-q", "main");

    const ledger = {
      execute: async (_s: string, fn: () => Promise<unknown>) => fn(),
    };
    await prepareBranch(
      ledger as never,
      baseProject(repo),
      "factory/E-1",
      git.branchExists,
      git.createBranch,
    );
    expect(await sh(repo, "rev-parse", "factory/E-1")).toBe(
      await sh(repo, "rev-parse", "develop"),
    );
    expect(await sh(repo, "rev-parse", "factory/E-1")).not.toBe(
      await sh(repo, "rev-parse", "main"),
    );
  });
});
