// test/git-abort.test.ts — The abort guarantee of the stage runner reaches every git subprocess prepare and deliver start (#163).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { DeliverExecutor } from "../src/executors/deliver.js";
import { PrepareExecutor } from "../src/executors/prepare.js";
import * as git from "../src/git.js";
import { execStrict } from "../src/proc.js";
import type { Project } from "../src/shared/types.js";
import { stageContext } from "./helpers/stage-harness.js";

let baseDir: string;
let repo: string;

async function run(cwd: string, ...args: string[]): Promise<string> {
  return (await execStrict("git", args, { cwd, envPolicy: "inherit" })).stdout;
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-git-abort-"));
  repo = path.join(baseDir, "repo");
  await run(baseDir, "init", "--initial-branch=main", repo);
  await run(repo, "config", "user.email", "test@xfactory.dev");
  await run(repo, "config", "user.name", "X-Factory Test");
  await writeFile(path.join(repo, "README.md"), "# Fixture\n");
  await run(repo, "add", "-A");
  await run(repo, "commit", "-m", "Initial commit");
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const ABORTED = AbortSignal.abort();

describe("git operations honour an abort signal", () => {
  it("createBranch does not create the branch once aborted", async () => {
    await expect(
      git.createBranch(repo, "never-created", "main", ABORTED),
    ).rejects.toThrow();
    expect(await git.branchExists(repo, "never-created")).toBe(false);
  });

  it("push, commit and head lookups fail instead of running once aborted", async () => {
    await expect(git.push(repo, "main", ABORTED)).rejects.toThrow();
    await expect(git.getHeadSha(repo, ABORTED)).rejects.toThrow();
    await expect(git.getHeadMessage(repo, ABORTED)).rejects.toThrow();
    await expect(git.getParentSha(repo, ABORTED)).rejects.toThrow();
    await expect(
      git.getRemoteBranchSha(repo, "origin", "main", ABORTED),
    ).rejects.toThrow();
    await expect(
      git.safeCommitAll(
        repo,
        "msg",
        {
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        },
        ABORTED,
      ),
    ).rejects.toThrow();
  });
});

describe("executors hand their abort signal to git", () => {
  const project: Project = {
    id: "proj-abort",
    name: "Abort",
    workspacePath: "/tmp/ws",
    repositoryPath: "/tmp/repo",
    defaultBranch: "main",
    testCommand: "true",
    repositories: [],
    issueTracker: { provider: "jira" },
  };

  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const repos = createRepositories(db);
    const created = repos.runs.create({
      id: "run-abort",
      projectId: project.id,
      projectName: project.name,
      ticket: { id: "T-1", title: "T", acceptanceCriteria: [] },
      plan: "P",
      branch: "factory/T-1",
      status: "preparing",
      artifactsDir: path.join(baseDir, "artifacts"),
      worktreePath: "/tmp/wt-abort",
    });
    return { repos, run: created };
  }

  it("prepare passes it to branch, worktree and baseline commands", async () => {
    const { repos, run: created } = setup();
    const controller = new AbortController();
    const seen: Record<string, unknown> = {};
    const executor = new PrepareExecutor({
      branchExists: async (_r, _b, signal) => {
        seen.branchExists = signal;
        return false;
      },
      createBranch: async (_r, _b, _base, signal) => {
        seen.createBranch = signal;
      },
      worktreeExists: async () => false,
      createWorktree: async (_r, _b, _p, _id, signal) => {
        seen.createWorktree = signal;
        return "/tmp/wt-abort";
      },
      recordBaseline: async (_p, signal) => {
        seen.recordBaseline = signal;
        return { trackedFiles: new Set(), untrackedFiles: new Set() };
      },
      readFile: async () => {
        throw new Error("no baseline yet");
      },
      writeFile: async () => {},
    });

    await executor.execute(
      stageContext(repos, created, project, { signal: controller.signal }),
    );

    expect(Object.keys(seen).sort()).toEqual([
      "branchExists",
      "createBranch",
      "createWorktree",
      "recordBaseline",
    ]);
    for (const signal of Object.values(seen)) {
      expect(signal).toBe(controller.signal);
    }
  });

  it("deliver passes it to commit, push and head lookups", async () => {
    const { repos, run: created } = setup();
    const controller = new AbortController();
    const seen: Record<string, unknown> = {};
    const record =
      (name: string, value: unknown = "sha") =>
      async (...args: unknown[]) => {
        seen[name] = args.at(-1);
        return value;
      };
    const executor = new DeliverExecutor({
      loadRecordedBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      safeCommitAll: record("safeCommitAll", undefined) as never,
      push: record("push", undefined) as never,
      getHeadSha: record("getHeadSha") as never,
      getHeadMessage: record("getHeadMessage") as never,
      getParentSha: record("getParentSha") as never,
      getRemoteBranchSha: record("getRemoteBranchSha") as never,
      findCommitByMessageAndParent: record("find", null) as never,
      findExistingPullRequest: async () => null,
      createPullRequest: async () => "https://example.test/pr/1",
    });

    await executor.execute(
      stageContext(repos, created, project, { signal: controller.signal }),
    );

    expect(Object.keys(seen).sort()).toEqual([
      "getHeadSha",
      "push",
      "safeCommitAll",
    ]);
    for (const signal of Object.values(seen)) {
      expect(signal).toBe(controller.signal);
    }
  });
});
