// test/azure-status.test.ts — Unit tests for Azure DevOps commit status reporting.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { publishAzureCommitStatus } from "../src/azure/status.js";

describe("Azure DevOps Status Reporter (src/azure/status.ts)", () => {
  it("fails safely if required options are missing", async () => {
    const res = await publishAzureCommitStatus({
      orgUrl: "",
      project: "",
      repoIdOrName: "",
      commitSha: "",
      state: "succeeded",
      description: "Checks passed",
    });
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("Missing required parameters"));
  });

  it("publishes status successfully to Azure DevOps status API with correct payload", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody:
      | {
          state?: string;
          context?: { name?: string; genre?: string };
          targetUrl?: string;
        }
      | undefined;
    let capturedAuth = "";

    const mockFetcher = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = url.toString();
      capturedMethod = init?.method || "";
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization || "";
      capturedBody = JSON.parse(init?.body as string);

      return new Response(JSON.stringify({ id: 9988 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await publishAzureCommitStatus({
      orgUrl: "https://dev.azure.com/myorg",
      project: "MyProject",
      repoIdOrName: "my-repo",
      commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      state: "succeeded",
      description: "Deterministic checks passed (attempt 1/3)",
      targetUrl: "http://localhost:3777/runs/run-123",
      pat: "my-pat-token",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, true);
    assert.equal(res.statusId, 9988);
    assert.equal(capturedMethod, "POST");
    assert.ok(
      capturedUrl.includes(
        "/_apis/git/repositories/my-repo/commits/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/statuses",
      ),
    );
    assert.ok(capturedAuth.startsWith("Basic "));
    assert.ok(capturedBody);
    assert.equal(capturedBody.state, "succeeded");
    assert.ok(capturedBody.context);
    assert.equal(capturedBody.context.name, "verification");
    assert.equal(capturedBody.context.genre, "x-factory");
    assert.equal(capturedBody.targetUrl, "http://localhost:3777/runs/run-123");
  });

  it("handles HTTP error response non-destructively", async () => {
    const mockFetcher = (async () => {
      return new Response("Insufficient permissions to update status", {
        status: 403,
      });
    }) as unknown as typeof fetch;

    const res = await publishAzureCommitStatus({
      orgUrl: "https://dev.azure.com/myorg",
      project: "MyProject",
      repoIdOrName: "my-repo",
      commitSha: "sha123",
      state: "failed",
      description: "Failed verification",
      pat: "pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("403"));
  });

  it("handles network failure without throwing", async () => {
    const mockFetcher = (async () => {
      throw new Error("DNS resolution failed");
    }) as unknown as typeof fetch;

    const res = await publishAzureCommitStatus({
      orgUrl: "https://dev.azure.com/myorg",
      project: "MyProject",
      repoIdOrName: "my-repo",
      commitSha: "sha123",
      state: "succeeded",
      description: "Passed",
      pat: "pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("DNS resolution failed"));
  });
});
