// test/azure-pr.test.ts — Unit tests for Azure DevOps PR creation and safety invariants.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import * as prModule from "../src/azure/pr.js";
import { createAzurePullRequest, normalizeGitRef } from "../src/azure/pr.js";

describe("Azure DevOps PR Creation (src/azure/pr.ts)", () => {
  describe("Safety Invariants (Strict Non-Merge & Non-Close Rules)", () => {
    it("strictly verifies that no merge, close, or abandon functions exist in src/azure/pr.ts", () => {
      const exportedKeys = Object.keys(prModule);
      const prohibitedKeywords = [
        "merge",
        "close",
        "abandon",
        "reject",
        "delete",
      ];

      for (const key of exportedKeys) {
        for (const bad of prohibitedKeywords) {
          assert.equal(
            key.toLowerCase().includes(bad),
            false,
            `Safety violation: function ${key} violates the strict non-merge/close invariant!`,
          );
        }
      }
    });
  });

  describe("normalizeGitRef", () => {
    it("prepends refs/heads/ if branch name does not have it", () => {
      assert.equal(
        normalizeGitRef("feat/my-feature"),
        "refs/heads/feat/my-feature",
      );
      assert.equal(normalizeGitRef("main"), "refs/heads/main");
    });

    it("leaves already prefixed refs/heads untouched", () => {
      assert.equal(normalizeGitRef("refs/heads/main"), "refs/heads/main");
    });
  });

  describe("createAzurePullRequest", () => {
    it("fails when required fields are missing", async () => {
      const res = await createAzurePullRequest({
        orgUrl: "",
        project: "",
        repoIdOrName: "",
        sourceBranch: "feat/1",
        targetBranch: "main",
        title: "Test PR",
        description: "Desc",
      });
      assert.equal(res.ok, false);
      assert.ok(res.error?.includes("Missing required Azure parameters"));
    });

    it("sends correct POST request to Azure DevOps pullrequests endpoint", async () => {
      let capturedUrl = "";
      let capturedBody:
        | {
            sourceRefName?: string;
            targetRefName?: string;
            title?: string;
          }
        | undefined;

      const mockFetcher = (async (
        url: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            pullRequestId: 456,
            url: "https://dev.azure.com/myorg/myproject/_git/my-repo/pullrequest/456",
            _links: {
              web: {
                href: "https://dev.azure.com/myorg/myproject/_git/my-repo/pullrequest/456",
              },
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const res = await createAzurePullRequest({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
        repoIdOrName: "my-repo",
        sourceBranch: "factory/ticket-123",
        targetBranch: "main",
        title: "[X-Factory] TIK-123: Implement feature",
        description: "Implemented by X-Factory",
        pat: "my-token",
        fetchFn: mockFetcher,
      });

      assert.equal(res.ok, true);
      assert.equal(res.pullRequestId, 456);
      assert.equal(
        res.url,
        "https://dev.azure.com/myorg/myproject/_git/my-repo/pullrequest/456",
      );
      assert.ok(
        capturedUrl.includes(
          "/_apis/git/repositories/my-repo/pullrequests?api-version=7.1",
        ),
      );
      assert.ok(capturedBody);
      assert.equal(capturedBody.sourceRefName, "refs/heads/factory/ticket-123");
      assert.equal(capturedBody.targetRefName, "refs/heads/main");
      assert.equal(
        capturedBody.title,
        "[X-Factory] TIK-123: Implement feature",
      );
    });

    it("handles error response from Azure API gracefully", async () => {
      const mockFetcher = (async () => {
        return new Response("Branch already has an active pull request", {
          status: 409,
        });
      }) as unknown as typeof fetch;

      const res = await createAzurePullRequest({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
        repoIdOrName: "my-repo",
        sourceBranch: "feat/existing",
        targetBranch: "main",
        title: "Title",
        description: "Desc",
        pat: "token",
        fetchFn: mockFetcher,
      });

      assert.equal(res.ok, false);
      assert.ok(res.error?.includes("409"));
    });
  });
});
