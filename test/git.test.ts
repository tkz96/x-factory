// test/git.test.ts — Git operations, external worktree paths, baseline tracking, and pollution guardrails.

import { describe, it, beforeAll, afterAll } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as git from "../src/git.js";
import { execStrict } from "../src/proc.js";
import { getWorktreePath, getRunMarkerPath } from "../src/paths.js";

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
  await execStrict("git", ["init", "--bare", bareRepo]);
  await execStrict("git", ["clone", bareRepo, fixtureRepo]);

  // Configure git user
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], { cwd: fixtureRepo });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], { cwd: fixtureRepo });

  // Create initial commit
  await writeFile(path.join(fixtureRepo, "README.md"), "# Fixture Repo\n");
  await execStrict("git", ["add", "-A"], { cwd: fixtureRepo });
  await execStrict("git", ["commit", "-m", "Initial commit"], { cwd: fixtureRepo });
  await execStrict("git", ["push", "origin", "main"], { cwd: fixtureRepo });
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
      /does not exist/
    );
  });

  it("throws for a directory that is not a git repo", async () => {
    const nonGitDir = path.join(baseTempDir, "not-git");
    await mkdir(nonGitDir, { recursive: true });
    await assert.rejects(() => git.validateRepo(nonGitDir), /Not a git repository/);
  });
});

describe("branchExists", () => {
  it("returns true for existing branch", async () => {
    assert.equal(await git.branchExists(fixtureRepo, "main"), true);
  });

  it("returns false for non-existent branch", async () => {
    assert.equal(await git.branchExists(fixtureRepo, "nonexistent-branch"), false);
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
      /already exists/
    );
  });
});

describe("createWorktree and removeWorktree", () => {
  it("creates external worktree without polluting the worktree with marker files", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-1", "main");
    const wtPath = await git.createWorktree(fixtureRepo, "wt-branch-1", "proj-1", "run-101");

    assert.equal(wtPath, getWorktreePath("proj-1", "run-101"));

    // Check that README.md exists in worktree
    const lsResult = await execStrict("ls", [wtPath]);
    assert.ok(lsResult.stdout.includes("README.md"));

    // Verify .xfactory-run marker is in runs directory, NOT inside the git worktree
    assert.ok(!lsResult.stdout.includes(".xfactory-run"), "Worktree must NOT contain .xfactory-run marker");

    const markerPath = getRunMarkerPath("proj-1", "run-101");
    const file = Bun.file(markerPath);
    assert.equal(await file.exists(), true, "Marker must exist in external runs directory");

    // Clean up worktree
    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

describe("recordBaseline and checkPollution", () => {
  it("detects clean state vs dangerous pollution files", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-2", "main");
    const wtPath = await git.createWorktree(fixtureRepo, "wt-branch-2", "proj-1", "run-102");

    const baseline = await git.recordBaseline(wtPath);
    assert.ok(baseline.trackedFiles.has("README.md"));

    // Clean check
    let pollution = await git.checkPollution(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    // Legitimate new file: src/feature.ts and .env.example are allowed!
    await mkdir(path.join(wtPath, "src"), { recursive: true });
    await writeFile(path.join(wtPath, "src", "feature.ts"), "export const x = 1;\n");
    await writeFile(path.join(wtPath, ".env.example"), "API_KEY=\n");

    pollution = await git.checkPollution(wtPath, baseline);
    assert.equal(pollution.hasPollution, false, "Legitimate files and .env.example must not trigger pollution");

    // Forbidden pollution file: debug.log
    await writeFile(path.join(wtPath, "debug.log"), "error log\n");
    pollution = await git.checkPollution(wtPath, baseline);
    assert.equal(pollution.hasPollution, true);
    assert.ok(pollution.details[0].includes("debug.log"));

    // Remove forbidden file
    await rm(path.join(wtPath, "debug.log"));
    pollution = await git.checkPollution(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

describe("getDiff and safeCommitAll", () => {
  it("extracts diff and commits safely", async () => {
    await git.createBranch(fixtureRepo, "wt-branch-3", "main");
    const wtPath = await git.createWorktree(fixtureRepo, "wt-branch-3", "proj-1", "run-103");
    const baseline = await git.recordBaseline(wtPath);

    // Initial diff is empty
    let diffRes = await git.getDiff(wtPath);
    assert.equal(diffRes.filesChanged.length, 0);

    // Throws when nothing to commit
    await assert.rejects(
      () => git.safeCommitAll(wtPath, "Empty commit", baseline),
      /Nothing to commit/
    );

    // Add legitimate modification
    await writeFile(path.join(wtPath, "new-module.ts"), "export function hello() {}\n");
    diffRes = await git.getDiff(wtPath);
    assert.ok(diffRes.filesChanged.includes("new-module.ts"));

    // Commit safely
    await git.safeCommitAll(wtPath, "Add new module", baseline);

    // Verify commit in git log
    const log = await execStrict("git", ["log", "--oneline", "-1"], { cwd: wtPath });
    assert.ok(log.stdout.includes("Add new module"));

    await git.removeWorktree(fixtureRepo, wtPath);
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
    const wtPath = await git.createWorktree(fixtureRepo, "wt-branch-safety", "proj-safety", "run-safety");
    const baseline = await git.recordBaseline(wtPath);

    // 1. .git is not in baseline
    for (const f of baseline.trackedFiles) {
      assert.ok(!f.startsWith(".git"), `Tracked file should not start with .git: ${f}`);
    }
    for (const f of baseline.untrackedFiles) {
      assert.ok(!f.startsWith(".git"), `Untracked file should not start with .git: ${f}`);
    }

    // 2. Pollution check ignores .git
    const pollution = await git.checkPollution(wtPath, baseline);
    assert.equal(pollution.hasPollution, false);

    // 3. Diff check ignores .git
    const diffRes = await git.getDiff(wtPath);
    for (const f of diffRes.filesChanged) {
      assert.ok(!f.includes(".git"), `Changed files should not include .git: ${f}`);
    }

    // 4. External X-Factory directory is NOT a git repository
    const xfactoryDataDir = process.env.X_FACTORY_DATA_DIR!;
    await assert.rejects(
      () => git.validateRepo(xfactoryDataDir),
      /Not a git repository/,
      "External X-Factory data directory must never be considered a git repository"
    );

    const projectDir = path.join(xfactoryDataDir, "projects", "proj-safety");
    await assert.rejects(
      () => git.validateRepo(projectDir),
      /Not a git repository/,
      "External project directory must never be considered a git repository"
    );

    await git.removeWorktree(fixtureRepo, wtPath);
  });
});

