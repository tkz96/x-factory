// test/inspection.test.ts — Unit tests for local repository inspection and project readiness.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateProject } from "../src/config.js";
import {
  checkProjectReadiness,
  detectRepositoryCommands,
  detectRepositoryRole,
  evaluateRepositoryReadiness,
  inspectLocalRepository,
} from "../src/inspection/index.js";
import { execStrict } from "../src/proc.js";

describe("Deterministic Inspection", () => {
  describe("detectRepositoryRole", () => {
    it("detects roles from repository names", () => {
      assert.equal(detectRepositoryRole("vendifai-web"), "frontend");
      assert.equal(detectRepositoryRole("vendifai-api"), "backend");
      assert.equal(detectRepositoryRole("worker-queue"), "worker");
      assert.equal(detectRepositoryRole("auth-service"), "service");
      assert.equal(detectRepositoryRole("vendifai-ios"), "mobile");
      assert.equal(detectRepositoryRole("infra-terraform"), "infrastructure");
      assert.equal(detectRepositoryRole("project-docs"), "documentation");
      assert.equal(detectRepositoryRole("vendifai-knowledge"), "knowledge");
      assert.equal(detectRepositoryRole("misc-utility"), "other");
    });

    it("detects frontend/backend from package.json dependencies", () => {
      const reactPkg = JSON.stringify({ dependencies: { react: "^18.0.0" } });
      assert.equal(detectRepositoryRole("my-client", reactPkg), "frontend");

      const expressPkg = JSON.stringify({
        dependencies: { express: "^4.18.0" },
      });
      assert.equal(detectRepositoryRole("my-server", expressPkg), "backend");
    });
  });

  describe("detectRepositoryCommands", () => {
    it("detects Bun commands when bun.lockb exists", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-detect-bun-"));
      try {
        await writeFile(
          path.join(dir, "package.json"),
          JSON.stringify({ scripts: { test: "bun test" } }),
        );
        await writeFile(path.join(dir, "bun.lockb"), "");
        await writeFile(path.join(dir, "tsconfig.json"), "{}");

        const { commands, tooling } = await detectRepositoryCommands(dir);
        assert.ok(tooling.includes("Bun"));
        assert.equal(commands.test, "bun test");
        assert.equal(commands.typecheck, "bunx tsc --noEmit");
        assert.equal(commands.lint, "bunx eslint .");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("detects Ruby and Rails when Gemfile exists", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-detect-ruby-"));
      try {
        await writeFile(
          path.join(dir, "Gemfile"),
          "source 'https://rubygems.org'\n",
        );

        const { commands, tooling } = await detectRepositoryCommands(dir);
        assert.ok(tooling.includes("Ruby / Bundler"));
        assert.equal(commands.test, "bundle exec rspec");
        assert.equal(commands.lint, "bundle exec rubocop");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("detects Cargo and Rust when Cargo.toml exists", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-detect-rust-"));
      try {
        await writeFile(
          path.join(dir, "Cargo.toml"),
          '[package]\nname = "demo"\n',
        );

        const { commands, tooling } = await detectRepositoryCommands(dir);
        assert.ok(tooling.includes("Rust / Cargo"));
        assert.equal(commands.test, "cargo test");
        assert.equal(commands.lint, "cargo clippy");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("inspectLocalRepository", () => {
    it("inspects a local git checkout", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-inspect-git-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict(
          "git",
          ["remote", "add", "origin", "https://github.com/vendifai/web.git"],
          { envPolicy: "inherit", cwd: dir },
        );
        await writeFile(
          path.join(dir, "package.json"),
          JSON.stringify({
            name: "vendifai-web",
            scripts: { test: "bun test" },
          }),
        );
        await writeFile(path.join(dir, "bun.lockb"), "");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const result = await inspectLocalRepository(dir);
        assert.equal(result.exists, true);
        assert.equal(result.isGitRepo, true);
        assert.equal(result.remote, "https://github.com/vendifai/web.git");
        assert.equal(result.role, "frontend");
        assert.equal(result.detectedCommands.test, "bun test");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("handles non-existent paths gracefully", async () => {
      const result = await inspectLocalRepository("/nonexistent/path/12345");
      assert.equal(result.exists, false);
      assert.equal(result.isGitRepo, false);
    });

    it("does not report expectedRemote when local remote is missing", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-inspect-no-remote-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await writeFile(path.join(dir, "README.md"), "# Init\n");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const result = await inspectLocalRepository(
          dir,
          "https://github.com/my-org/expected.git",
        );
        assert.equal(result.remote, undefined);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("returns currentBranch as undefined on detached HEAD without falling back to default branch", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-inspect-detached-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await writeFile(path.join(dir, "README.md"), "# Detached\n");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["checkout", "--detach"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const result = await inspectLocalRepository(dir);
        assert.equal(result.currentBranch, undefined);
        assert.notEqual(result.currentBranch, "main");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("evaluateRepositoryReadiness", () => {
    it("returns pending_setup when expectedRemote is configured but local repo has no remote", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-readiness-no-remote-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await writeFile(path.join(dir, "README.md"), "# Test\n");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const readiness = await evaluateRepositoryReadiness({
          id: "repo-1",
          name: "Repo 1",
          path: dir,
          remote: "https://github.com/my-org/expected.git",
          defaultBranch: "main",
        });

        assert.equal(readiness.status, "pending_setup");
        assert.equal(readiness.remoteMatches, false);
        assert.equal(
          readiness.message,
          "Local Git remote URL does not match configured remote.",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("matches an ssh:// origin with a trailing slash against its HTTPS remote", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-readiness-ssh-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict(
          "git",
          [
            "remote",
            "add",
            "origin",
            "ssh://git@github.com/my-org/expected.git/",
          ],
          {
            envPolicy: "inherit",
            cwd: dir,
          },
        );

        const readiness = await evaluateRepositoryReadiness({
          id: "repo-ssh",
          name: "Repo SSH",
          path: dir,
          remote: "https://github.com/my-org/expected.git",
          defaultBranch: "main",
        });

        assert.equal(readiness.remoteMatches, true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("returns pending_setup when checkout is in detached HEAD state", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-readiness-detached-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await writeFile(path.join(dir, "README.md"), "# Detached\n");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["checkout", "--detach"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const readiness = await evaluateRepositoryReadiness({
          id: "repo-1",
          name: "Repo 1",
          path: dir,
          defaultBranch: "main",
        });

        assert.equal(readiness.status, "pending_setup");
        assert.equal(readiness.branchDetected, false);
        assert.equal(readiness.message, "Repository requires local setup.");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("checkProjectReadiness", () => {
    it("evaluates ready vs pending setup projects", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-readiness-"));
      try {
        await execStrict("git", ["init", dir], { envPolicy: "inherit" });
        await execStrict("git", ["config", "user.email", "test@test.com"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["config", "user.name", "Test"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await writeFile(path.join(dir, "README.md"), "# Ready");
        await execStrict("git", ["add", "-A"], {
          envPolicy: "inherit",
          cwd: dir,
        });
        await execStrict("git", ["commit", "-m", "Init"], {
          envPolicy: "inherit",
          cwd: dir,
        });

        const readyProject = validateProject({
          id: "ready-proj",
          name: "Ready Project",
          issueTracker: { connectionId: "github" },
          repositories: [
            {
              id: "r1",
              name: "Repo 1",
              path: dir,
              defaultBranch: "main",
              commands: { test: "echo test" },
            },
          ],
        });

        const readyResult = await checkProjectReadiness(readyProject);
        assert.equal(readyResult.ready, true);
        assert.equal(readyResult.readyCount, 1);
        assert.equal(readyResult.totalCount, 1);
        assert.equal(readyResult.issues.length, 0);

        const pendingProject = validateProject({
          id: "pending-proj",
          name: "Pending Project",
          issueTracker: { connectionId: "github" },
          repositories: [
            {
              id: "r-missing",
              name: "Missing Repo",
              path: "/tmp/nonexistent-123456",
              defaultBranch: "main",
            },
          ],
        });

        const pendingResult = await checkProjectReadiness(pendingProject);
        assert.equal(pendingResult.ready, false);
        assert.equal(pendingResult.readyCount, 0);
        assert.ok(pendingResult.issues.length > 0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
