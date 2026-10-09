// test/git.test.ts — Git operations, external worktree paths, baseline tracking, and pollution guardrails.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as git from "../src/git.js";
import { getRunMarkerPath, getWorktreePath } from "../src/paths.js";
import { execStrict } from "../src/proc.js";
import { readWorktreeState, recordBaseline } from "../src/worktree-state.js";

let baseTempDir: string;
let fixtureRepo: string;
let bareRepo: string;

beforeAll(async () => {
  baseTempDir = await mkdtemp(path.join(tmpdir(), "xf-git-test-"));
  // Set custom X_FACTORY_DATA_DIR for test isolation
  process.env.X_FACTORY_DATA_DIR = path.join(baseTempDir, "data");

  bareRepo = path.join(baseTempDir, "bare.git");
  fixtureRepo = path.join(baseTempDir, "repo");

  // Create bare repo and clone it
  await execStrict(
    "git",
    ["init", "--bare", "--initial-branch=main", bareRepo],
    { envPolicy: "inherit" },
  );
  await execStrict("git", ["clone", bareRepo, fixtureRepo], {
    envPolicy: "inherit",
  });

  // Configure git user and branch
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["checkout", "-B", "main"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });

  // Create initial commit
  await writeFile(path.join(fixtureRepo, "README.md"), "# Fixture Repo\n");
  await execStrict("git", ["add", "-A"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["push", "-u", "origin", "main"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
});

afterAll(async () => {
  if (baseTempDir) {
    await rm(baseTempDir, { recursive: true, force: true });
  }
});

describe("validateRepo", () => {
  it("succeeds for a valid git repository", async () => {
    await git.validateRepo(fixtureRepo);
  });

  it("throws for a non-existent path", async () => {
    await assert.rejects(
      () => git.validateRepo("/tmp/nonexistent-xfactory-test-path-12345"),
      /does not exist/,
    );
  });

  it("throws for a directory that is not a git repo", async () => {
    const nonGitDir = path.join(baseTempDir, "not-git");
    await mkdir(nonGitDir, { recursive: true });
    await assert.rejects(
      () => git.validateRepo(nonGitDir),
      /Not a git repository/,
    );
  });
});

describe("branchExists", () => {
  it("returns true for existing branch", async () => {
    assert.equal(await git.branchExists(fixtureRepo, "main"), true);
  });

  it("returns false for non-existent branch", async () => {
    assert.equal(
      await git.branchExists(fixtureRepo, "nonexistent-branch"),
      false,
    );
  });
});

describe("createBranch", () => {
  it("creates a new branch from base", async () => {
    await git.createBranch(fixtureRepo, "feature-test-1", "main");
    assert.equal(await git.branchExists(fixtureRepo, "feature-test-1"), true);
  });

  it("throws if branch already exists", async () => {
    await assert.rejects(
      () => git.createBranch(fixtureRepo, "feature-test-1", "main"),
      /already exists/,
    );
  });
});

describe("createWorktree and removeWorktree", () => {
  it("creates external worktree without polluting the worktree with marker files", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-1", "main");
    const wtPath = await git.createWorktree(
      fixtureRepo,
      "wt-branch-1",
      "proj-1",
      "run-101",
    );

    assert.equal(wtPath, getWorktreePath("proj-1", "run-101"));

    // Check that README.md exists in worktree
    const lsResult = await execStrict("ls", [wtPath], { envPolicy: "inherit" });
    assert.ok(lsResult.stdout.includes("README.md"));

    // Verify .xfactory-run marker is in runs directory, NOT inside the git worktree
    assert.ok(
      !lsResult.stdout.includes(".xfactory-run"),
      "Worktree must NOT contain .xfactory-run marker",
    );

    const markerPath = getRunMarkerPath("proj-1", "run-101");
    const file = Bun.file(markerPath);
    assert.equal(
      await file.exists(),
      true,
      "Marker must exist in external runs directory",
    );

    // Clean up worktree
    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

describe("recordBaseline and pollution detection", () => {
  it("detects clean state vs dangerous pollution files", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-2", "main");
    const wtPath = await git.createWorktree(
      fixtureRepo,
      "wt-branch-2",
      "proj-1",
      "run-102",
    );

    const baseline = await recordBaseline(wtPath);
    assert.ok(baseline.trackedFiles.has("README.md"));

    // Clean check
    let pollution = await readWorktreeState(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    // Legitimate new file: src/feature.ts and .env.example are allowed!
    await mkdir(path.join(wtPath, "src"), { recursive: true });
    await writeFile(
      path.join(wtPath, "src", "feature.ts"),
      "export const x = 1;\n",
    );
    await writeFile(path.join(wtPath, ".env.example"), "API_KEY=\n");

    pollution = await readWorktreeState(wtPath, baseline);
    assert.equal(
      pollution.hasPollution,
      false,
      "Legitimate files and .env.example must not trigger pollution",
    );

    // Forbidden pollution file: debug.log
    await writeFile(path.join(wtPath, "debug.log"), "error log\n");
    pollution = await readWorktreeState(wtPath, baseline);
    assert.equal(pollution.hasPollution, true);
    assert.ok(pollution.pollutionDetails[0]?.includes("debug.log"));

    // Remove forbidden file
    await rm(path.join(wtPath, "debug.log"));
    pollution = await readWorktreeState(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

describe("getDiff and safeCommitAll", () => {
  it("extracts diff and commits safely", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-3", "main");
    const wtPath = await git.createWorktree(
      fixtureRepo,
      "wt-branch-3",
      "proj-1",
      "run-103",
    );
    const baseline = await recordBaseline(wtPath);

    // Initial diff is empty
    let diffRes = await git.getDiff(wtPath, baseline);
    assert.equal(diffRes.filesChanged.length, 0);

    // Throws when nothing to commit
    await assert.rejects(
      () => git.safeCommitAll(wtPath, "Empty commit", baseline),
      /Nothing to commit/,
    );

    // Add legitimate modification
    await writeFile(
      path.join(wtPath, "new-module.ts"),
      "export function hello() {}\n",
    );
    diffRes = await git.getDiff(wtPath, baseline);
    assert.ok(diffRes.filesChanged.includes("new-module.ts"));

    // Commit safely
    await git.safeCommitAll(wtPath, "Add new module", baseline);

    // Verify commit in git log
    const log = await execStrict("git", ["log", "--oneline", "-1"], {
      envPolicy: "inherit",
      cwd: wtPath,
    });
    assert.ok(log.stdout.includes("Add new module"));

    await git.removeWorktree(fixtureRepo, wtPath);
  });

  it("commits over 1000 changed paths, passing them to git in chunks", async () => {
    const chunkRepo = await mkdtemp(path.join(tmpdir(), "xf-git-chunk-"));
    try {
      await execStrict("git", ["init", "--initial-branch=main", chunkRepo], {
        envPolicy: "inherit",
      });
      await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
        cwd: chunkRepo,
        envPolicy: "inherit",
      });
      await execStrict("git", ["config", "user.name", "X-Factory Test"], {
        cwd: chunkRepo,
        envPolicy: "inherit",
      });
      await writeFile(path.join(chunkRepo, "README.md"), "# Fixture\n");
      await execStrict("git", ["add", "-A"], {
        cwd: chunkRepo,
        envPolicy: "inherit",
      });
      await execStrict("git", ["commit", "-m", "Initial commit"], {
        cwd: chunkRepo,
        envPolicy: "inherit",
      });

      const baseline = await recordBaseline(chunkRepo);

      // More paths than fit in one git invocation (chunk size is 1000).
      const expected: string[] = [];
      await mkdir(path.join(chunkRepo, "bulk"), { recursive: true });
      const writes: Promise<void>[] = [];
      for (let i = 0; i < 1100; i++) {
        const rel = `bulk/file-${String(i).padStart(4, "0")}.txt`;
        writes.push(writeFile(path.join(chunkRepo, rel), `content ${i}\n`));
        expected.push(rel);
      }
      await Promise.all(writes);

      await git.safeCommitAll(chunkRepo, "Add bulk files", baseline);

      const show = await execStrict(
        "git",
        ["show", "--name-only", "--format=", "HEAD"],
        { cwd: chunkRepo, envPolicy: "inherit" },
      );
      assert.deepEqual(
        show.stdout.split("\n").filter(Boolean).sort(),
        expected.sort(),
        "every path must reach the commit across chunked git add calls",
      );
    } finally {
      await rm(chunkRepo, { recursive: true, force: true });
    }
  });
});

describe("reportStaleWorktrees", () => {
  it("reports orphaned worktrees non-destructively", async () => {
    const stale = await git.reportStaleWorktrees("proj-1");
    assert.ok(Array.isArray(stale));
  });
});

describe("Git Metadata and External Directory Safety", () => {
  it("ensures .git and Git metadata are excluded from scans and external dir is never a repo", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-safety", "main");
    const wtPath = await git.createWorktree(
      fixtureRepo,
      "wt-branch-safety",
      "proj-safety",
      "run-safety",
    );
    const baseline = await recordBaseline(wtPath);

    // 1. .git metadata is not in baseline
    for (const f of [...baseline.trackedFiles, ...baseline.untrackedFiles]) {
      assert.ok(
        f !== ".git" && !f.startsWith(".git/"),
        `Baseline should not include .git metadata: ${f}`,
      );
    }

    // 2. Pollution check ignores .git
    const pollution = await readWorktreeState(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    // 3. Diff check ignores .git metadata
    const diffRes = await git.getDiff(wtPath, baseline);
    for (const f of diffRes.filesChanged) {
      assert.ok(
        f !== ".git" && !f.startsWith(".git/"),
        `Changed files should not include .git metadata: ${f}`,
      );
    }

    // 4. External X-Factory directory is NOT a git repository
    const xfactoryDataDir = process.env.X_FACTORY_DATA_DIR;
    assert.ok(
      xfactoryDataDir,
      "X_FACTORY_DATA_DIR must be set in test environment",
    );
    await assert.rejects(
      () => git.validateRepo(xfactoryDataDir),
      /Not a git repository/,
      "External X-Factory data directory must never be considered a git repository",
    );

    const projectDir = path.join(xfactoryDataDir, "projects", "proj-safety");
    await assert.rejects(
      () => git.validateRepo(projectDir),
      /Not a git repository/,
      "External project directory must never be considered a git repository",
    );

    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

describe("findCommitByMessageAndParent", () => {
  it("returns SHA when commit exists in current HEAD ancestry", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-find-1", "main");
    const wtPath = await git.createWorktree(
      fixtureRepo,
      "wt-branch-find-1",
      "proj-1",
      "run-find-1",
    );
    const parentSha = await git.getHeadSha(wtPath);

    const baseline = await recordBaseline(wtPath);
    await writeFile(path.join(wtPath, "file1.txt"), "hello");
    await git.safeCommitAll(wtPath, "[X-Factory] Test Commit", baseline);
    const commitSha = await git.getHeadSha(wtPath);

    const foundSha = await git.findCommitByMessageAndParent(
      wtPath,
      "[X-Factory] Test Commit",
      parentSha,
    );
    assert.equal(foundSha, commitSha);

    await git.removeWorktree(fixtureRepo, wtPath);
  });

  it("returns null when commit exists only on another branch (not in current HEAD history)", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-find-2-base", "main");
    const wtPathBase = await git.createWorktree(
      fixtureRepo,
      "wt-branch-find-2-base",
      "proj-1",
      "run-find-2",
    );
    const parentSha = await git.getHeadSha(wtPathBase);

    const baseline = await recordBaseline(wtPathBase);
    await writeFile(path.join(wtPathBase, "file2.txt"), "hello base");
    await git.safeCommitAll(wtPathBase, "[X-Factory] Target Commit", baseline);

    await git.createBranch(fixtureRepo, "wt-branch-find-2-other", "main");
    const wtPathOther = await git.createWorktree(
      fixtureRepo,
      "wt-branch-find-2-other",
      "proj-1",
      "run-find-3",
    );

    const foundSha = await git.findCommitByMessageAndParent(
      wtPathOther,
      "[X-Factory] Target Commit",
      parentSha,
    );
    assert.equal(
      foundSha,
      null,
      "Should return null because commit is not in current HEAD history",
    );

    await git.removeWorktree(fixtureRepo, wtPathBase);
    await git.removeWorktree(fixtureRepo, wtPathOther);
  });

  it("throws when git history lookup fails", async () => {
    await assert.rejects(
      () =>
        git.findCommitByMessageAndParent(
          "/invalid/path/that/does/not/exist",
          "Some message",
          "some-sha",
        ),
      /Failed to search git history/,
    );
  });
});

describe("getParentSha and getHeadMessage", () => {
  it("returns parent SHA and commit message of HEAD", async () => {
    const headMsg = await git.getHeadMessage(fixtureRepo);
    assert.equal(headMsg, "Initial commit");

    // Create a commit (baseline first: a file untracked at baseline is not a change)
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(path.join(fixtureRepo, "newfile.txt"), "content");
    const parentBefore = await git.getHeadSha(fixtureRepo);
    await git.safeCommitAll(fixtureRepo, "second commit", baseline);

    const parentAfter = await git.getParentSha(fixtureRepo);
    assert.equal(parentAfter, parentBefore);

    const newHeadMsg = await git.getHeadMessage(fixtureRepo);
    assert.equal(newHeadMsg, "second commit");
  });
});

describe("getRemoteBranchSha", () => {
  it("resolves branch SHA from a local remote", async () => {
    const sha = await git.getRemoteBranchSha(fixtureRepo, fixtureRepo, "main");
    const headSha = await git.getHeadSha(fixtureRepo);
    assert.equal(sha, headSha);
  });

  it("returns null for non-existent branch", async () => {
    const sha = await git.getRemoteBranchSha(
      fixtureRepo,
      fixtureRepo,
      "non-existent-branch-12345",
    );
    assert.equal(sha, null);
  });

  it("throws when remote lookup fails", async () => {
    await assert.rejects(
      () => git.getRemoteBranchSha("/invalid/path", "invalid-remote", "main"),
      /Git lookup failed for remote branch/,
    );
  });
});
