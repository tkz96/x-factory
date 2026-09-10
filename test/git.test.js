// test/git.test.js — Git helper tests using a temporary fixture repo.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as git from "../server/git.js";

const exec = promisify(execFile);

let fixtureDir;

async function run(cmd, args, cwd) {
  await exec(cmd, args, { cwd });
}

before(async () => {
  // Create a temporary bare repo and a clone to use as a fixture.
  const base = await mkdtemp(path.join(tmpdir(), "xf-test-"));
  const bareDir = path.join(base, "bare.git");
  fixtureDir = path.join(base, "repo");

  // Init bare repo.
  await run("git", ["init", "--bare", bareDir]);

  // Clone it.
  await run("git", ["clone", bareDir, fixtureDir]);

  // Configure git user for commits.
  await run("git", ["config", "user.email", "test@xfactory.dev"], fixtureDir);
  await run("git", ["config", "user.name", "X-Factory Test"], fixtureDir);

  // Create an initial commit so branches work.
  await writeFile(path.join(fixtureDir, "README.md"), "# Test Repo\n");
  await run("git", ["add", "-A"], fixtureDir);
  await run("git", ["commit", "-m", "Initial commit"], fixtureDir);
  await run("git", ["push", "origin", "main"], fixtureDir);
});

after(async () => {
  // Clean up temp dir.
  if (fixtureDir) {
    const base = path.dirname(fixtureDir);
    await rm(base, { recursive: true, force: true });
  }
});

describe("validateRepo", () => {
  it("succeeds for a valid repo", async () => {
    await git.validateRepo(fixtureDir); // Should not throw.
  });

  it("throws for a non-existent path", async () => {
    await assert.rejects(
      () => git.validateRepo("/tmp/nonexistent-xfactory-test-repo"),
      /does not exist/
    );
  });
});

describe("branchExists", () => {
  it("returns true for an existing branch", async () => {
    assert.ok(await git.branchExists(fixtureDir, "main"));
  });

  it("returns false for a non-existent branch", async () => {
    assert.ok(!(await git.branchExists(fixtureDir, "nonexistent-branch")));
  });
});

describe("createBranch", () => {
  it("creates a new branch", async () => {
    await git.createBranch(fixtureDir, "test-branch-1", "main");
    assert.ok(await git.branchExists(fixtureDir, "test-branch-1"));
  });

  it("throws if branch already exists", async () => {
    await assert.rejects(
      () => git.createBranch(fixtureDir, "test-branch-1", "main"),
      /already exists/
    );
  });
});

describe("createWorktree and removeWorktree", () => {
  it("creates and removes a worktree", async () => {
    // Create a branch for the worktree.
    await git.createBranch(fixtureDir, "wt-branch", "main");

    const wtPath = await git.createWorktree(fixtureDir, "wt-branch", "wt-test-1");
    assert.ok(wtPath.includes("wt-test-1"));

    // Verify the worktree exists and has files.
    const { stdout } = await exec("ls", [wtPath]);
    assert.ok(stdout.includes("README.md"));

    // Remove it.
    await git.removeWorktree(fixtureDir, wtPath);
  });
});

describe("commitAll", () => {
  it("commits staged changes", async () => {
    // Create a branch and worktree.
    await git.createBranch(fixtureDir, "commit-branch", "main");
    const wtPath = await git.createWorktree(fixtureDir, "commit-branch", "commit-test-1");

    // Make a change.
    await writeFile(path.join(wtPath, "new-file.txt"), "Hello X-Factory\n");

    // Commit.
    await git.commitAll(wtPath, "Test commit");

    // Verify.
    const { stdout } = await exec("git", ["log", "--oneline", "-1"], { cwd: wtPath });
    assert.ok(stdout.includes("Test commit"));

    // Clean up.
    await git.removeWorktree(fixtureDir, wtPath);
  });

  it("throws when nothing to commit", async () => {
    await git.createBranch(fixtureDir, "empty-commit-branch", "main");
    const wtPath = await git.createWorktree(fixtureDir, "empty-commit-branch", "empty-commit-test");

    await assert.rejects(
      () => git.commitAll(wtPath, "Empty commit"),
      /Nothing to commit/
    );

    await git.removeWorktree(fixtureDir, wtPath);
  });
});

describe("worktreeDir", () => {
  it("returns the expected path", () => {
    const dir = git.worktreeDir("/home/user/my-app", "abc123");
    assert.equal(dir, "/home/user/my-app/.x-factory/worktrees/abc123");
  });
});
