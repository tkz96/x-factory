// test/azure.test.ts — Unit tests for Azure DevOps authentication and connection testing.

import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  formatAzureAuthHeader,
  getAzureCliAuthHeader,
  resolveAzureAuthHeader,
} from "../src/azure/auth.js";
import {
  fetchAzureRepoNames,
  parseAzureTarget,
  resolveAzureAuthInfo,
  testAzureConnection,
} from "../src/azure/connection.js";

const originalFetch = globalThis.fetch;

describe("Azure DevOps Authentication (src/azure/auth.ts)", () => {
  describe("formatAzureAuthHeader", () => {
    it("returns empty string for empty or whitespace-only PAT", () => {
      assert.equal(formatAzureAuthHeader(""), "");
      assert.equal(formatAzureAuthHeader("   "), "");
    });

    it("formats JWT token with Bearer scheme when starting with eyJ", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID";
      assert.equal(formatAzureAuthHeader(jwt), `Bearer ${jwt}`);
    });

    it("formats standard Azure PAT as Basic base64(:PAT)", () => {
      const pat = "my-azure-devops-pat-token-12345";
      const header = formatAzureAuthHeader(pat);
      assert.ok(header.startsWith("Basic "));

      const base64Part = header.slice(6);
      const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      assert.equal(decoded, `:${pat}`);
    });

    it("trims whitespace before formatting", () => {
      const pat = "  token-with-spaces  ";
      const header = formatAzureAuthHeader(pat);
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
      assert.equal(decoded, ":token-with-spaces");
    });
  });

  describe("getAzureCliAuthHeader", () => {
    it("returns empty string immediately in test environment without executor", async () => {
      const header = await getAzureCliAuthHeader();
      assert.equal(header, "");
    });

    it("resolves Bearer token when executor succeeds with valid stdout", async () => {
      let recordedCmd = "";
      let recordedArgs: string[] = [];
      const mockExecutor: import("../src/azure/auth.js").CliCommandExecutor =
        async (cmd, args) => {
          recordedCmd = cmd;
          recordedArgs = args;
          return { passed: true, stdout: "az-token-xyz-789\n" };
        };

      const header = await getAzureCliAuthHeader(mockExecutor);
      assert.equal(header, "Bearer az-token-xyz-789");
      assert.equal(recordedCmd, "az");
      assert.ok(recordedArgs.includes("account"));
      assert.ok(recordedArgs.includes("get-access-token"));
    });

    it("returns empty string when executor reports command failed", async () => {
      const mockExecutor: import("../src/azure/auth.js").CliCommandExecutor =
        async () => {
          return { passed: false, stdout: "" };
        };

      const header = await getAzureCliAuthHeader(mockExecutor);
      assert.equal(header, "");
    });

    it("returns empty string when executor returns whitespace only stdout", async () => {
      const mockExecutor: import("../src/azure/auth.js").CliCommandExecutor =
        async () => {
          return { passed: true, stdout: "   \n" };
        };

      const header = await getAzureCliAuthHeader(mockExecutor);
      assert.equal(header, "");
    });

    it("returns empty string when executor throws an error", async () => {
      const mockExecutor: import("../src/azure/auth.js").CliCommandExecutor =
        async () => {
          throw new Error("az CLI not installed or logged in");
        };

      const header = await getAzureCliAuthHeader(mockExecutor);
      assert.equal(header, "");
    });
  });

  describe("resolveAzureAuthHeader", () => {
    it("returns formatted header when PAT is provided", async () => {
      const header = await resolveAzureAuthHeader("test-pat-123");
      assert.ok(header.startsWith("Basic "));
    });

    it("returns empty string when no PAT provided in test environment without executor", async () => {
      const header = await resolveAzureAuthHeader(undefined);
      assert.equal(header, "");
      const headerEmpty = await resolveAzureAuthHeader("   ");
      assert.equal(headerEmpty, "");
    });

    it("delegates to executor when PAT is omitted or whitespace", async () => {
      const mockExecutor: import("../src/azure/auth.js").CliCommandExecutor =
        async () => {
          return { passed: true, stdout: "fallback-az-token" };
        };

      const header = await resolveAzureAuthHeader(undefined, mockExecutor);
      assert.equal(header, "Bearer fallback-az-token");

      const headerFromWhitespace = await resolveAzureAuthHeader(
        "   ",
        mockExecutor,
      );
      assert.equal(headerFromWhitespace, "Bearer fallback-az-token");
    });
  });
});

describe("Azure DevOps Connection Testing (src/azure/connection.ts)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("parseAzureTarget", () => {
    it("parses separate orgUrl and project, trimming trailing slashes", () => {
      const target = parseAzureTarget({
        orgUrl: "https://dev.azure.com/myorg///",
        project: "MyProject",
      });
      assert.deepEqual(target, {
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
      });
    });

    it("extracts org and project from combined URL in project field", () => {
      const target = parseAzureTarget({
        project: "https://dev.azure.com/enterprise-org/CorePlatform",
      });
      assert.ok(target);
      assert.equal(target?.orgUrl, "https://dev.azure.com/enterprise-org");
      assert.equal(target?.project, "CorePlatform");
    });

    it("returns null when orgUrl or project cannot be determined", () => {
      assert.equal(parseAzureTarget({}), null);
      assert.equal(parseAzureTarget({ orgUrl: "   " }), null);
      assert.equal(parseAzureTarget({ project: "   " }), null);
    });
  });

  describe("resolveAzureAuthInfo", () => {
    it("identifies Personal Access Token when pat is provided", async () => {
      const info = await resolveAzureAuthInfo("my-secret-pat");
      assert.equal(info.authMethod, "Personal Access Token");
      assert.ok(info.authHeader.startsWith("Basic "));
    });

    it("returns empty auth header when no credentials exist", async () => {
      const info = await resolveAzureAuthInfo(undefined);
      assert.equal(info.authHeader, "");
      assert.equal(info.authMethod, "");
    });
  });

  describe("fetchAzureRepoNames", () => {
    it("returns array of repository names on 200 OK", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            value: [
              { id: "r1", name: "repo-alpha" },
              { id: "r2", name: "repo-beta" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const repos = await fetchAzureRepoNames(
        "https://dev.azure.com/org/proj/_apis/git/repositories",
        "Basic dGVzdA==",
      );
      assert.deepEqual(repos, ["repo-alpha", "repo-beta"]);
    });

    it("handles empty repository list cleanly", async () => {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ value: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const repos = await fetchAzureRepoNames("https://api.test", "auth");
      assert.deepEqual(repos, []);
    });

    it("throws error with status code and body on HTTP failure", async () => {
      globalThis.fetch = (async () => {
        return new Response("Unauthorized access", { status: 401 });
      }) as unknown as typeof fetch;

      await assert.rejects(
        () => fetchAzureRepoNames("https://api.test", "auth"),
        /Azure responded with status 401: Unauthorized access/,
      );
    });
  });

  describe("testAzureConnection", () => {
    it("fails when organization or project is missing", async () => {
      const res = await testAzureConnection({});
      assert.equal(res.ok, false);
      assert.equal(res.provider, "azure");
      assert.ok(
        res.error?.includes(
          "Both Azure Organization URL and Project Name are required",
        ),
      );
    });

    it("fails when authentication is missing", async () => {
      const res = await testAzureConnection({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproj",
        pat: "",
      });
      assert.equal(res.ok, false);
      assert.ok(res.error?.includes("Authentication required"));
    });

    it("successfully connects and lists repositories with valid credentials", async () => {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        assert.ok(headers.Authorization.startsWith("Basic "));
        return new Response(
          JSON.stringify({
            value: [
              { id: "1", name: "service-backend" },
              { id: "2", name: "service-frontend" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const res = await testAzureConnection({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproj",
        pat: "valid-pat-token-123",
      });

      assert.equal(res.ok, true);
      assert.equal(res.provider, "azure");
      assert.equal(res.project, "myproj");
      assert.equal(res.repoCount, 2);
      assert.deepEqual(res.repositories, [
        "service-backend",
        "service-frontend",
      ]);
      assert.equal(res.authMethod, "Personal Access Token");
      assert.ok(res.message?.includes("Successfully connected"));
    });

    it("catches and returns API errors gracefully", async () => {
      globalThis.fetch = (async () => {
        return new Response("Resource not found", { status: 404 });
      }) as unknown as typeof fetch;

      const res = await testAzureConnection({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproj",
        pat: "valid-pat",
      });

      assert.equal(res.ok, false);
      assert.equal(res.provider, "azure");
      assert.ok(res.error?.includes("Azure responded with status 404"));
    });

    it("catches network and DNS errors gracefully", async () => {
      globalThis.fetch = (async () => {
        throw new Error("getaddrinfo ENOTFOUND dev.azure.com");
      }) as unknown as typeof fetch;

      const res = await testAzureConnection({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproj",
        pat: "valid-pat",
      });

      assert.equal(res.ok, false);
      assert.ok(res.error?.includes("ENOTFOUND"));
    });

    it("never leaks raw PAT secrets in connection result or error message", async () => {
      const sensitivePat = "SUPER_SECRET_PAT_NEVER_LEAK_987654321";

      globalThis.fetch = (async () => {
        throw new Error("Connection failed due to internal network failure");
      }) as unknown as typeof fetch;

      const res = await testAzureConnection({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproj",
        pat: sensitivePat,
      });

      const serialized = JSON.stringify(res);
      assert.ok(!serialized.includes(sensitivePat));
      assert.ok(!res.error?.includes(sensitivePat));
      if (res.message) {
        assert.ok(!res.message.includes(sensitivePat));
      }
    });
  });
});
