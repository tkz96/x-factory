// test/github.test.ts — Unit tests for GitHub CLI forge integration.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPullRequest } from "../src/github.js";

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
});
