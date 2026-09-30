// test/github.test.ts — Unit tests for GitHub CLI forge integration.

import { describe, expect, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPullRequest,
  findExistingPullRequest,
  type GitHubDeps,
} from "../src/github.js";

describe("GitHub CLI Integration (github.ts)", () => {
  it("rejects when run in a non-git directory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "xfactory-gh-test-"));
    try {
      await assert.rejects(
        () => createPullRequest(tmpDir, "Test PR", "Test body", "main"),
        /gh.*failed/i,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds existing pull request when gh returns valid json", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh pr view",
        exitCode: 0,
        stdout: JSON.stringify({
          url: "https://github.com/org/repo/pull/42",
          headRefName: "factory/feature",
          headRefOid: "sha123",
          baseRefName: "main",
          state: "OPEN",
        }),
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
      execStrict: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    const pr = await findExistingPullRequest(
      "/tmp",
      "factory/feature",
      mockDeps,
    );
    expect(pr).not.toBeNull();
    expect(pr?.url).toBe("https://github.com/org/repo/pull/42");
    expect(pr?.state).toBe("OPEN");
  });

  it("returns null when no pull requests found", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh pr view",
        exitCode: 1,
        stdout: "",
        stderr: "no pull requests found for branch 'factory/feature'",
        durationMs: 10,
        passed: false,
      }),
      execStrict: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    const pr = await findExistingPullRequest(
      "/tmp",
      "factory/feature",
      mockDeps,
    );
    expect(pr).toBeNull();
  });

  it("throws when gh pr view fails with other error", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh pr view",
        exitCode: 1,
        stdout: "",
        stderr: "network error connecting to api.github.com",
        durationMs: 10,
        passed: false,
      }),
      execStrict: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    await expect(
      findExistingPullRequest("/tmp", "factory/feature", mockDeps),
    ).rejects.toThrow("GitHub PR lookup failed: exit code 1");
  });

  it("throws when gh pr view outputs invalid json", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh pr view",
        exitCode: 0,
        stdout: "NOT JSON",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
      execStrict: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    await expect(
      findExistingPullRequest("/tmp", "factory/feature", mockDeps),
    ).rejects.toThrow("GitHub PR lookup failed (invalid JSON)");
  });

  it("returns null when json lacks url", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh pr view",
        exitCode: 0,
        stdout: JSON.stringify({ state: "OPEN" }),
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
      execStrict: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    const pr = await findExistingPullRequest(
      "/tmp",
      "factory/feature",
      mockDeps,
    );
    expect(pr).toBeNull();
  });

  it("creates pull request using mock execStrict", async () => {
    const mockDeps: GitHubDeps = {
      execCommand: async () => ({
        command: "gh",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
      execStrict: async () => ({
        command: "gh pr create",
        exitCode: 0,
        stdout: "https://github.com/org/repo/pull/99\n",
        stderr: "",
        durationMs: 10,
        passed: true,
      }),
    };

    const url = await createPullRequest(
      "/tmp",
      "Title",
      "Body",
      "main",
      mockDeps,
    );
    expect(url).toBe("https://github.com/org/repo/pull/99");
  });
});
