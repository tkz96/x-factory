// test/azure-scopes.test.ts — Unit tests for Azure DevOps PAT scope diagnostic prober.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { testAzurePatScopes } from "../src/azure/scopes.js";

describe("Azure DevOps PAT Scopes Prober (src/azure/scopes.ts)", () => {
  it("fails immediately when orgUrl or project is missing", async () => {
    const res = await testAzurePatScopes({
      orgUrl: "",
      project: "",
      pat: "test",
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("required")));
  });

  it("fails immediately when no authentication is provided", async () => {
    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "",
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("Authentication required")));
  });

  it("passes when all required scopes are present and write probe is unauthorized (least privilege)", async () => {
    const mockFetcher = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const urlStr = url.toString();
      const headers = (init?.headers || {}) as Record<string, string>;
      assert.ok(headers.Authorization?.startsWith("Basic "));

      // Probe 1: WIQL (Work Items: Read)
      if (urlStr.includes("/_apis/wit/wiql")) {
        return new Response(JSON.stringify({ workItems: [{ id: 101 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Probe 2: Git repos (Code: Read)
      if (urlStr.includes("/_apis/git/repositories?")) {
        return new Response(
          JSON.stringify({
            value: [{ id: "repo-123", name: "my-app" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Probe 3: Commits statuses (Code: Status)
      if (urlStr.includes("/commits/") && urlStr.includes("/statuses")) {
        return new Response(JSON.stringify({ value: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Probe 4: Synthetic write patch (Work Items: Write probe)
      // Least-privilege token gets 401/403 Unauthorized for write operation
      if (urlStr.includes("/_apis/wit/workitems/-1")) {
        return new Response("Unauthorized to write work items", {
          status: 401,
        });
      }

      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "valid-least-privilege-pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, true);
    assert.equal(res.scopes.workItemsRead, true);
    assert.equal(res.scopes.codeRead, true);
    assert.equal(res.scopes.codeStatus, true);
    assert.equal(res.scopes.workItemsWriteDetected, false);
    assert.equal(res.errors.length, 0);
  });

  it("fails and flags missing required scopes when WIQL or repos return 401/403", async () => {
    const mockFetcher = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      // WIQL fails with 401 (Missing Work Items: Read)
      if (urlStr.includes("/_apis/wit/wiql")) {
        return new Response("Forbidden", { status: 403 });
      }
      // Code Read succeeds
      if (urlStr.includes("/_apis/git/repositories?")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      // Code Status fails with 401 (Missing Code: Status)
      if (urlStr.includes("/statuses")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "under-privileged-pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, false);
    assert.equal(res.scopes.workItemsRead, false);
    assert.equal(res.scopes.codeRead, true);
    assert.equal(res.scopes.codeStatus, false);
    assert.ok(
      res.errors.some((e) => e.includes("Work Items (Read)")),
      "Should report missing Work Items (Read)",
    );
    assert.ok(
      res.errors.some((e) => e.includes("Code (Status)")),
      "Should report missing Code (Status)",
    );
  });

  it("detects over-privileged PAT warning when Work Items: Write probe succeeds (404 on -1)", async () => {
    const mockFetcher = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/_apis/wit/wiql")) {
        return new Response(JSON.stringify({ workItems: [] }), { status: 200 });
      }
      if (urlStr.includes("/_apis/git/repositories?")) {
        return new Response(
          JSON.stringify({ value: [{ id: "r1", name: "repo" }] }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/statuses")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      // Azure returns 404 when write authorization succeeded but work item -1 doesn't exist
      if (urlStr.includes("/_apis/wit/workitems/-1")) {
        return new Response("Work item -1 not found", { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "over-privileged-write-pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, true);
    assert.equal(res.overPrivileged, true);
    assert.equal(res.scopes.workItemsRead, true);
    assert.equal(res.scopes.codeRead, true);
    assert.equal(res.scopes.codeStatus, true);
    assert.equal(res.scopes.workItemsWriteDetected, true);
    assert.ok(
      res.warnings.some((w) => w.includes("Work Items (Write)")),
      "Should warn about over-privileged Work Items (Write)",
    );
  });

  it("detects over-privileged PAT warning when Code: Full probe succeeds", async () => {
    const mockFetcher = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/_apis/wit/wiql")) {
        return new Response(JSON.stringify({ workItems: [] }), { status: 200 });
      }
      if (urlStr.includes("/_apis/git/repositories?")) {
        return new Response(
          JSON.stringify({ value: [{ id: "r1", name: "repo" }] }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/statuses")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      if (urlStr.includes("/recycleBin/repositories")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "over-privileged-full-code-pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, true);
    assert.equal(res.overPrivileged, true);
    assert.equal(res.scopes.codeFullDetected, true);
    assert.ok(
      res.warnings.some((w) => w.includes("Code (Full)")),
      "Should warn about over-privileged Code (Full)",
    );
  });

  it("handles network failures gracefully without crashing", async () => {
    const mockFetcher = (async () => {
      throw new Error("Network timeout or connection refused");
    }) as unknown as typeof fetch;

    const res = await testAzurePatScopes({
      orgUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      pat: "pat",
      fetchFn: mockFetcher,
    });

    assert.equal(res.ok, false);
    assert.equal(res.scopes.workItemsRead, false);
    assert.equal(res.scopes.codeRead, false);
  });
});
