// test/azure-provider.test.ts — Comprehensive Azure DevOps Provider test suite.
//
// Wayfinder #127 / Ticket #139:
// - Provider-conformant Azure module (src/providers/azure-module.ts)
// - Serializer gate verification
// - Defect H2 fix: organization vs orgUrl mismatch detection
// - Internal auth token resolution (PAT Basic, JWT Bearer, Azure CLI fallback)
// - HTML-on-2xx normalization (auth wall detection)
// - Verification probes: ideal vs degraded (CAPABILITY_UNCONFIRMED)
// - parseQuickUrl pre-fills both tracker and git-host roles
// - REST-primary PR creation conforming to PR_CREATE_ONLY
// - Zero mocks except at the HTTP/network boundary

import { describe, expect, it } from "bun:test";
import {
  handleManifestRoute,
  handleParseUrlRoute,
  handleVerifyRoute,
} from "../src/http/providers-controller.js";
import {
  AZURE_PR_POLICY,
  AzureApiError,
  azureConfigSchema,
  azureProvider,
  createAzureProvider,
  detectOrganizationMismatch,
  extractOrgNameFromUrl,
  isHtmlResponse,
  resolveAzureAuth,
  toUserError,
} from "../src/providers/azure-module.js";
import { hasCapability, PR_CREATE_ONLY } from "../src/providers/contract.js";
import {
  getProvider,
  listProviders,
  requireProvider,
} from "../src/providers/registry.js";
import {
  type ProviderDescriptor,
  serializeProvider,
  serializeProviderConfigSchema,
} from "../src/providers/serializer.js";

describe("Azure DevOps Provider Module (Ticket #139)", () => {
  describe("Registration & Contract Conformance", () => {
    it("is registered in the static provider registry with expected identity and roles", () => {
      const provider = getProvider("azure");
      expect(provider).toBeDefined();
      expect(provider?.id).toBe("azure");
      expect(provider?.displayName).toBe("Azure DevOps");
      expect(provider?.roles).toEqual(["tracker", "gitHost"]);
      expect(provider?.iconRef).toBe("provider-azure");

      const required = requireProvider("azure");
      expect(required).toBe(azureProvider);

      const all = listProviders();
      expect(all.some((p) => p.id === "azure")).toBe(true);
    });

    it("declares and implements all required and optional provider capabilities", () => {
      expect(typeof azureProvider.verifyCredentials).toBe("function");
      expect(typeof azureProvider.toUserError).toBe("function");

      expect(hasCapability(azureProvider, "verifyScopes")).toBe(true);
      expect(hasCapability(azureProvider, "listRepositories")).toBe(true);
      expect(hasCapability(azureProvider, "listTickets")).toBe(true);
      expect(hasCapability(azureProvider, "parseQuickUrl")).toBe(true);
      expect(hasCapability(azureProvider, "createPullRequest")).toBe(true);
      expect(hasCapability(azureProvider, "findExistingPullRequest")).toBe(
        true,
      );
    });

    it("strictly adheres to the PR_CREATE_ONLY safety invariant (no merge/close capabilities)", () => {
      expect(AZURE_PR_POLICY).toBe(PR_CREATE_ONLY);
      expect(AZURE_PR_POLICY).toBe("create-only");

      // Verify no mutating methods leak onto the provider object
      const providerAny = azureProvider as unknown as Record<string, unknown>;
      expect(providerAny.mergePullRequest).toBeUndefined();
      expect(providerAny.closePullRequest).toBeUndefined();
      expect(providerAny.abandonPullRequest).toBeUndefined();
      expect(providerAny.deletePullRequest).toBeUndefined();
    });
  });

  describe("Schema Validation & Serializer Gate", () => {
    it("serializes through the generic serializer gate with zero errors", () => {
      const descriptor = serializeProvider(azureProvider);
      expect(descriptor).not.toBeNull();
      expect(descriptor?.id).toBe("azure");
      expect(descriptor?.displayName).toBe("Azure DevOps");
      expect(descriptor?.roles).toEqual(["tracker", "gitHost"]);
      expect(descriptor?.iconRef).toBe("provider-azure");
      expect(descriptor?.capabilities).toContain("createPullRequest");
      expect(descriptor?.capabilities).toContain("listRepositories");
      expect(descriptor?.capabilities).toContain("parseQuickUrl");

      const fields = serializeProviderConfigSchema(azureProvider.configSchema);
      expect(fields.length).toBe(3);

      const orgUrlField = fields.find((f) => f.name === "orgUrl");
      expect(orgUrlField).toBeDefined();
      expect(orgUrlField?.type).toBe("url");
      expect(orgUrlField?.required).toBe(true);

      const projectField = fields.find((f) => f.name === "project");
      expect(projectField).toBeDefined();
      expect(projectField?.type).toBe("text");
      expect(projectField?.required).toBe(true);

      const patField = fields.find((f) => f.name === "pat");
      expect(patField).toBeDefined();
      expect(patField?.type).toBe("secret");
      expect(patField?.required).toBe(false);
      // envKey must be stripped by the serializer gate
      expect(patField).not.toHaveProperty("envKey");
    });

    it("validates valid and invalid configurations against azureConfigSchema", () => {
      const validWithoutPat = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
      });
      expect(validWithoutPat.success).toBe(true);

      const validWithPat = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
        pat: "my-azure-pat-token",
      });
      expect(validWithPat.success).toBe(true);

      const missingOrgUrl = azureConfigSchema.safeParse({
        project: "MyProject",
      });
      expect(missingOrgUrl.success).toBe(false);

      const invalidOrgUrl = azureConfigSchema.safeParse({
        orgUrl: "not-a-valid-url",
        project: "MyProject",
      });
      expect(invalidOrgUrl.success).toBe(false);

      const missingProject = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
      });
      expect(missingProject.success).toBe(false);
    });
  });

  describe("H2 Defect Fix: Organization vs orgUrl Mismatch Detection", () => {
    it("extracts org name correctly from dev.azure.com, visualstudio.com, and ssh URLs", () => {
      expect(extractOrgNameFromUrl("https://dev.azure.com/my-org")).toBe(
        "my-org",
      );
      expect(extractOrgNameFromUrl("https://dev.azure.com/My-Org/")).toBe(
        "my-org",
      );
      expect(extractOrgNameFromUrl("https://my-org.visualstudio.com")).toBe(
        "my-org",
      );
      expect(
        extractOrgNameFromUrl("git@ssh.dev.azure.com:v3/my-org/project/repo"),
      ).toBe("my-org");
      expect(
        extractOrgNameFromUrl("https://invalid-domain.com/foo"),
      ).toBeNull();
    });

    it("verifies single schema field orgUrl exactly as entered without mutation", () => {
      const config = {
        orgUrl: "https://dev.azure.com/acme-corp",
        project: "Backend",
      };
      const mismatch = detectOrganizationMismatch(config);
      expect(mismatch.mismatch).toBe(false);
    });

    it("detects and rejects conflicting organization property (H2 fix)", () => {
      const config = {
        orgUrl: "https://dev.azure.com/acme-corp",
        organization: "contoso",
        project: "Backend",
      };
      const mismatch = detectOrganizationMismatch(config);
      expect(mismatch.mismatch).toBe(true);
      expect(mismatch.error).toContain("Configuration mismatch");
      expect(mismatch.error).toContain("contoso");
      expect(mismatch.error).toContain("acme-corp");
    });

    it("detects and rejects conflicting nested organization configurations (#129 nested detection)", () => {
      // nested azure.organization
      const nestedAzure = {
        orgUrl: "https://dev.azure.com/acme-corp",
        project: "Backend",
        azure: {
          organization: "fabrikam",
        },
      };
      expect(detectOrganizationMismatch(nestedAzure).mismatch).toBe(true);

      // nested tracker.organization
      const nestedTracker = {
        orgUrl: "https://dev.azure.com/acme-corp",
        project: "Backend",
        tracker: {
          org: "other-org",
        },
      };
      expect(detectOrganizationMismatch(nestedTracker).mismatch).toBe(true);

      // nested conflicting orgUrl
      const nestedUrl = {
        orgUrl: "https://dev.azure.com/acme-corp",
        project: "Backend",
        tracker: {
          orgUrl: "https://dev.azure.com/different-org",
        },
      };
      expect(detectOrganizationMismatch(nestedUrl).mismatch).toBe(true);
    });

    it("accepts consistent configuration when organization matches embedded orgUrl", () => {
      const consistent = {
        orgUrl: "https://dev.azure.com/acme-corp",
        organization: "acme-corp",
        project: "Backend",
      };
      expect(detectOrganizationMismatch(consistent).mismatch).toBe(false);
    });

    it("proves verifyCredentials throws configuration mismatch error on conflicting organization", async () => {
      const provider = createAzureProvider();
      await expect(
        provider.verifyCredentials({
          orgUrl: "https://dev.azure.com/acme-corp",
          organization: "conflict-org",
          project: "Backend",
        }),
      ).rejects.toThrow(/Configuration mismatch/);
    });
  });

  describe("Token Acquisition & Auth Resolution", () => {
    it("formats standard PAT as HTTP Basic Auth header", async () => {
      const auth = await resolveAzureAuth("my-pat-12345");
      expect(auth).toBe(
        `Basic ${Buffer.from(":my-pat-12345").toString("base64")}`,
      );
    });

    it("formats JWT token (starting with eyJ) as Bearer Auth header", async () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig";
      const auth = await resolveAzureAuth(jwt);
      expect(auth).toBe(`Bearer ${jwt}`);
    });

    it("falls back to Azure CLI when PAT is empty or not provided", async () => {
      const mockCliExecutor = async (cmd: string, args: string[]) => {
        expect(cmd).toBe("az");
        expect(args).toContain("get-access-token");
        return { passed: true, stdout: "cli-token-xyz\n" };
      };

      const auth = await resolveAzureAuth("", mockCliExecutor);
      expect(auth).toBe("Bearer cli-token-xyz");

      const authUndef = await resolveAzureAuth(undefined, mockCliExecutor);
      expect(authUndef).toBe("Bearer cli-token-xyz");
    });

    it("handles failed Azure CLI fallback cleanly without throwing", async () => {
      const failingCliExecutor = async () => ({ passed: false, stdout: "" });
      const auth = await resolveAzureAuth(undefined, failingCliExecutor);
      expect(auth).toBe("");
    });
  });

  describe("HTML-on-2xx Normalization & Auth Wall Detection", () => {
    it("detects HTML content-type and common HTML markup elements", () => {
      expect(isHtmlResponse("text/html; charset=utf-8", "hello")).toBe(true);
      expect(
        isHtmlResponse(
          "application/json",
          "<!DOCTYPE html><html><body>Login</body></html>",
        ),
      ).toBe(true);
      expect(
        isHtmlResponse(
          "text/plain",
          "<html><head><title>Sign in</title></head></html>",
        ),
      ).toBe(true);
      expect(isHtmlResponse("application/json", '{"value":[]}')).toBe(false);
      expect(isHtmlResponse(null, undefined)).toBe(false);
    });

    it("normalizes an HTTP 200 with HTML body to AUTH_INVALID user error", () => {
      const htmlError = new AzureApiError("Sign in required", {
        status: 200,
        isHtml: true,
      });

      const userError = toUserError(htmlError, "VERIFY");
      expect(userError).toEqual({
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
    });

    it("normalizes HTTP 203 Non-Authoritative Information to AUTH_INVALID", () => {
      const err203 = new AzureApiError("Non-Authoritative Information", {
        status: 203,
      });
      const userError = toUserError(err203, "DISCOVERY");
      expect(userError).toEqual({
        code: "AUTH_INVALID",
        context: "DISCOVERY",
      });
    });
  });

  describe("toUserError Provider Error Mapping", () => {
    it("maps 401 Unauthorized to AUTH_INVALID", () => {
      const err = new AzureApiError("Unauthorized", { status: 401 });
      expect(toUserError(err, "VERIFY")).toEqual({
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
    });

    it("maps 403 Forbidden to PERMISSION", () => {
      const err = new AzureApiError("Forbidden", { status: 403 });
      expect(toUserError(err, "PR")).toEqual({
        code: "PERMISSION",
        context: "PR",
      });
    });

    it("maps 404 Not Found to NOT_FOUND", () => {
      const err = new AzureApiError("Project not found", { status: 404 });
      expect(toUserError(err, "VERIFY")).toEqual({
        code: "NOT_FOUND",
        context: "VERIFY",
      });
    });

    it("maps 429 and TF400733 to RATE_LIMITED with retryAfterMs conversion", () => {
      const err = new AzureApiError(
        "TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource",
        {
          status: 429,
          isRateLimit: true,
          retryAfterMs: 45000,
        },
      );
      expect(toUserError(err, "TICKETS")).toEqual({
        code: "RATE_LIMITED",
        context: "TICKETS",
        retryAfterMs: 45000,
      });
    });

    it("maps unexpected errors to UNKNOWN", () => {
      const err = new Error("Connection reset by peer");
      expect(toUserError(err, "DISCOVERY")).toEqual({
        code: "UNKNOWN",
        context: "DISCOVERY",
      });
    });
  });

  describe("Verification Probes & Degraded Classification (CAPABILITY_UNCONFIRMED)", () => {
    it("returns status: 'ok' with empty warnings when all probes succeed (ideal path)", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        // Repos probe
        if (urlStr.includes("/_apis/git/repositories?")) {
          return new Response(
            JSON.stringify({
              value: [{ id: "repo-1", name: "repo-alpha" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Work items probe
        if (urlStr.includes("/_apis/wit/wiql?")) {
          return new Response(JSON.stringify({ workItems: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // PR write probe
        if (urlStr.includes("/pullrequests?")) {
          // Azure returns 400 when authorized but branches are synthetic
          return new Response(JSON.stringify({ message: "Invalid branch" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: "valid-pat",
      });

      expect(result.status).toBe("ok");
      expect(result.warnings).toEqual([]);
    });

    it("returns status: 'degraded' with CAPABILITY_UNCONFIRMED for createPullRequest when read succeeds but write fails (degraded path)", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        // Repos read succeeds
        if (urlStr.includes("/_apis/git/repositories?")) {
          return new Response(
            JSON.stringify({
              value: [{ id: "repo-1", name: "repo-alpha" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Work items read succeeds
        if (urlStr.includes("/_apis/wit/wiql?")) {
          return new Response(JSON.stringify({ workItems: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // PR write probe fails with 403 (read-only token)
        if (urlStr.includes("/pullrequests?")) {
          return new Response(
            JSON.stringify({
              message:
                "TF401027: You need the Git Create pull request permission",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: "read-only-pat",
      });

      expect(result.status).toBe("degraded");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "createPullRequest",
      });
    });

    it("returns status: 'degraded' with CAPABILITY_UNCONFIRMED for listTickets when work items probe returns 403", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("/_apis/git/repositories?")) {
          return new Response(
            JSON.stringify({
              value: [{ id: "repo-1", name: "repo-alpha" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Work items read returns 403 (code-only PAT)
        if (urlStr.includes("/_apis/wit/wiql?")) {
          return new Response("Forbidden", { status: 403 });
        }
        // PR write succeeds
        if (urlStr.includes("/pullrequests?")) {
          return new Response("Invalid branch", { status: 400 });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: "code-only-pat",
      });

      expect(result.status).toBe("degraded");
      expect(result.warnings).toContainEqual({
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listTickets",
      });
    });

    it("throws when authentication itself fails on repos probe (auth wall or 401)", async () => {
      // 401 test
      const authFailFetch = (async () => {
        return new Response("Unauthorized", { status: 401 });
      }) as unknown as typeof fetch;

      const provider401 = createAzureProvider({ fetchFn: authFailFetch });
      await expect(
        provider401.verifyCredentials({
          orgUrl: "https://dev.azure.com/acme",
          project: "MyProject",
          pat: "bad-pat",
        }),
      ).rejects.toThrow();

      // HTML portal redirect test (200 with HTML)
      const htmlPortalFetch = (async () => {
        return new Response(
          "<!DOCTYPE html><html><body>Microsoft Login</body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html" },
          },
        );
      }) as unknown as typeof fetch;

      const providerHtml = createAzureProvider({ fetchFn: htmlPortalFetch });
      let caughtErr: unknown;
      try {
        await providerHtml.verifyCredentials({
          orgUrl: "https://dev.azure.com/acme",
          project: "MyProject",
          pat: "expired-pat",
        });
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      const mapped = providerHtml.toUserError(caughtErr, "VERIFY");
      expect(mapped).toEqual({
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
    });
  });

  describe("parseQuickUrl", () => {
    it("parses https://dev.azure.com/org/project into both tracker and gitHost drafts", () => {
      const parsed = azureProvider.parseQuickUrl?.(
        "https://dev.azure.com/myorg/myproject",
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.configDraft).toEqual({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
      });
      expect(parsed?.inferredName).toBe("myproject");
    });

    it("parses dev.azure.com/org/project without protocol", () => {
      const parsed = azureProvider.parseQuickUrl?.(
        "dev.azure.com/myorg/myproject",
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.configDraft).toEqual({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
      });
      expect(parsed?.inferredName).toBe("myproject");
    });

    it("parses URL containing a git repository path and infers repository name", () => {
      const parsed = azureProvider.parseQuickUrl?.(
        "https://dev.azure.com/myorg/myproject/_git/backend-api",
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.configDraft).toEqual({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
      });
      expect(parsed?.inferredName).toBe("backend-api");
    });

    it("parses visualstudio.com legacy URLs", () => {
      const parsed = azureProvider.parseQuickUrl?.(
        "https://myorg.visualstudio.com/myproject/_git/web-client",
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.configDraft).toEqual({
        orgUrl: "https://myorg.visualstudio.com",
        project: "myproject",
      });
      expect(parsed?.inferredName).toBe("web-client");
    });

    it("parses SSH Azure DevOps URLs", () => {
      const parsed = azureProvider.parseQuickUrl?.(
        "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.configDraft).toEqual({
        orgUrl: "https://dev.azure.com/myorg",
        project: "myproject",
      });
      expect(parsed?.inferredName).toBe("myrepo");
    });

    it("returns null for non-Azure URLs", () => {
      expect(
        azureProvider.parseQuickUrl?.("https://github.com/org/repo"),
      ).toBeNull();
      expect(
        azureProvider.parseQuickUrl?.("https://gitlab.com/org/repo"),
      ).toBeNull();
      expect(azureProvider.parseQuickUrl?.("")).toBeNull();
    });
  });

  describe("listRepositories", () => {
    it("queries repositories and maps to ProviderRepository format", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        expect(String(url)).toContain(
          "/_apis/git/repositories?api-version=7.1",
        );
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "r1",
                name: "repo-alpha",
                remoteUrl: "https://dev.azure.com/org/proj/_git/repo-alpha",
                defaultBranch: "refs/heads/main",
                webUrl: "https://dev.azure.com/org/proj/_git/repo-alpha",
              },
              {
                id: "r2",
                name: "repo-beta",
                remoteUrl: "https://dev.azure.com/org/proj/_git/repo-beta",
                defaultBranch: "refs/heads/develop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.listRepositories) {
        throw new Error("listRepositories is not defined");
      }
      const repos = await provider.listRepositories({
        orgUrl: "https://dev.azure.com/org",
        project: "proj",
        pat: "test-pat",
      });

      expect(repos).toHaveLength(2);
      expect(repos[0]).toEqual({
        id: "r1",
        name: "repo-alpha",
        remote: "https://dev.azure.com/org/proj/_git/repo-alpha",
        defaultBranch: "main",
        webUrl: "https://dev.azure.com/org/proj/_git/repo-alpha",
      });
      expect(repos[1]?.defaultBranch).toBe("develop");
    });
  });

  describe("listTickets", () => {
    it("fetches tickets using WIQL query and batch endpoint", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          const urlStr = String(url);
          if (urlStr.includes("/_apis/wit/wiql?")) {
            return new Response(
              JSON.stringify({
                workItems: [
                  {
                    id: 101,
                    url: "https://dev.azure.com/org/proj/_apis/wit/workitems/101",
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (urlStr.includes("/_apis/wit/workitems?ids=")) {
            return new Response(
              JSON.stringify({
                value: [
                  {
                    id: 101,
                    fields: {
                      "System.Title": "Task 101: Test ticket",
                      "System.Description": "<p>Description</p>",
                      "Microsoft.VSTS.Common.AcceptanceCriteria":
                        "Criteria 1\nCriteria 2",
                      "System.Tags": "backend; x-factory",
                    },
                    _links: {
                      html: {
                        href: "https://dev.azure.com/org/proj/_workitems/edit/101",
                      },
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        if (!azureProvider.listTickets) {
          throw new Error("listTickets is not defined");
        }
        const tickets = await azureProvider.listTickets(
          {
            orgUrl: "https://dev.azure.com/org",
            project: "proj",
            pat: "valid-pat",
          },
          { requiredLabel: "x-factory" },
        );

        expect(tickets).toHaveLength(1);
        expect(tickets[0]?.id).toBe("AZ-101");
        expect(tickets[0]?.title).toBe("Task 101: Test ticket");
        expect(tickets[0]?.provider).toBe("azure");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("createPullRequest & findExistingPullRequest", () => {
    it("creates a pull request via REST-primary endpoint and returns ProviderPullRequest", async () => {
      let requestBody: Record<string, unknown> | undefined;
      const fakeFetch: typeof fetch = (async (
        url: string | URL | Request,
        init?: RequestInit,
      ) => {
        expect(String(url)).toContain(
          "/_apis/git/repositories/my-repo/pullrequests?api-version=7.1",
        );
        expect(init?.method).toBe("POST");
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            pullRequestId: 42,
            url: "https://dev.azure.com/org/proj/_apis/git/repositories/my-repo/pullrequests/42",
            _links: {
              web: {
                href: "https://dev.azure.com/org/proj/_git/my-repo/pullrequest/42",
              },
            },
            status: "active",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.createPullRequest) {
        throw new Error("createPullRequest is not defined");
      }
      const pr = await provider.createPullRequest(
        {
          orgUrl: "https://dev.azure.com/org",
          project: "proj",
          pat: "test-pat",
        },
        {
          repository: "my-repo",
          title: "feat: add azure provider",
          description: "Implements Ticket #139",
          sourceBranch: "feat/139-azure",
          targetBranch: "main",
        },
      );

      expect(requestBody?.sourceRefName).toBe("refs/heads/feat/139-azure");
      expect(requestBody?.targetRefName).toBe("refs/heads/main");
      expect(requestBody?.title).toBe("feat: add azure provider");
      expect(pr.url).toBe(
        "https://dev.azure.com/org/proj/_git/my-repo/pullrequest/42",
      );
      expect(pr.sourceBranch).toBe("feat/139-azure");
      expect(pr.targetBranch).toBe("main");
    });

    it("finds existing active pull request for source branch", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        expect(String(url)).toContain("searchCriteria.status=active");
        expect(String(url)).toContain(
          "searchCriteria.sourceRefName=refs%2Fheads%2Ffeat%2F139-azure",
        );
        return new Response(
          JSON.stringify({
            value: [
              {
                pullRequestId: 99,
                status: "active",
                sourceRefName: "refs/heads/feat/139-azure",
                targetRefName: "refs/heads/main",
                lastMergeSourceCommit: { commitId: "abcdef123456" },
                _links: {
                  web: {
                    href: "https://dev.azure.com/org/proj/_git/my-repo/pullrequest/99",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.findExistingPullRequest) {
        throw new Error("findExistingPullRequest is not defined");
      }
      const found = await provider.findExistingPullRequest(
        {
          orgUrl: "https://dev.azure.com/org",
          project: "proj",
          pat: "test-pat",
        },
        {
          repository: "my-repo",
          sourceBranch: "feat/139-azure",
        },
      );

      expect(found).not.toBeNull();
      expect(found?.url).toBe(
        "https://dev.azure.com/org/proj/_git/my-repo/pullrequest/99",
      );
      expect(found?.lastMergeSourceCommit).toBe("abcdef123456");
      expect(found?.targetBranch).toBe("main");
    });

    it("returns null when no existing pull request is active", async () => {
      const fakeFetch = (async () => {
        return new Response(JSON.stringify({ value: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.findExistingPullRequest) {
        throw new Error("findExistingPullRequest is not defined");
      }
      const found = await provider.findExistingPullRequest(
        {
          orgUrl: "https://dev.azure.com/org",
          project: "proj",
          pat: "test-pat",
        },
        {
          repository: "my-repo",
          sourceBranch: "nonexistent-branch",
        },
      );

      expect(found).toBeNull();
    });
  });

  describe("verifyScopes Capability", () => {
    it("reports scope findings and over-privilege status", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("/_apis/wit/wiql?")) {
          return new Response(JSON.stringify({ workItems: [] }), {
            status: 200,
          });
        }
        if (urlStr.includes("/_apis/git/repositories?")) {
          return new Response(
            JSON.stringify({ value: [{ id: "r1", name: "repo1" }] }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/pullrequests?")) {
          return new Response("Invalid branch", { status: 400 });
        }
        if (urlStr.includes("/_apis/git/recycleBin/repositories?")) {
          return new Response("Forbidden", { status: 403 });
        }
        if (urlStr.includes("/_apis/wit/workitems/-1?")) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.verifyScopes) {
        throw new Error("verifyScopes is not defined");
      }
      const report = await provider.verifyScopes({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: "scoped-pat",
      });

      expect(report.overPrivileged).toBe(false);
      expect(report.findings).toContainEqual({
        capability: "listTickets",
        status: "confirmed",
      });
      expect(report.findings).toContainEqual({
        capability: "listRepositories",
        status: "confirmed",
      });
      expect(report.findings).toContainEqual({
        capability: "createPullRequest",
        status: "confirmed",
      });
      expect(report.findings).toContainEqual({
        capability: "verifyScopes",
        status: "confirmed",
      });
    });

    it("detects over-privileged token when recycle bin or workitem write succeeds", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("/recycleBin/repositories?")) {
          // Recycle bin 200 indicates Code: Full (admin)
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }) as typeof fetch;

      const provider = createAzureProvider({ fetchFn: fakeFetch });
      if (!provider.verifyScopes) {
        throw new Error("verifyScopes is not defined");
      }
      const report = await provider.verifyScopes({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: "admin-pat",
      });

      expect(report.overPrivileged).toBe(true);
    });
  });

  describe("HTTP Controller Routes with Azure Provider (#137 integration)", () => {
    it("serves Azure descriptor via GET /api/providers/manifest", async () => {
      const url = new URL("http://localhost/api/providers/manifest");
      const req = new Request(url);
      const res = await handleManifestRoute(req, url);
      expect(res.status).toBe(200);
      const data = (await res.json()) as ProviderDescriptor[];
      const azureDesc = data.find((p) => p.id === "azure");
      expect(azureDesc).toBeDefined();
      if (!azureDesc) {
        throw new Error("azureDesc not found");
      }
      expect(azureDesc.displayName).toBe("Azure DevOps");
      expect(azureDesc.roles).toEqual(["tracker", "gitHost"]);
      expect(azureDesc.configFields.some((f) => f.name === "orgUrl")).toBe(
        true,
      );
      expect(azureDesc.configFields.some((f) => f.name === "project")).toBe(
        true,
      );
      expect(azureDesc.configFields.some((f) => f.name === "pat")).toBe(true);
      // envKey must not leak
      expect(
        azureDesc.configFields.find((f) => f.name === "pat"),
      ).not.toHaveProperty("envKey");
    });

    it("handles POST /api/providers/verify with schema validation 409 on missing Azure fields", async () => {
      const req = new Request("http://localhost/api/providers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "azure",
          config: {},
        }),
      });
      const res = await handleVerifyRoute(req);
      expect(res.status).toBe(409);
      const data = (await res.json()) as {
        fieldErrors: Record<string, string>;
      };
      expect(data.fieldErrors.orgUrl).toBe("REQUIRED");
      expect(data.fieldErrors.project).toBe("REQUIRED");
    });

    it("resolves Azure quick URL via POST /api/providers/parse-url", async () => {
      const req = new Request("http://localhost/api/providers/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://dev.azure.com/my-corp/frontend-app/_git/web",
        }),
      });
      const res = await handleParseUrlRoute(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        providerId: string;
        configDraft: Record<string, unknown>;
        inferredName: string;
      };
      expect(data.providerId).toBe("azure");
      expect(data.configDraft).toEqual({
        orgUrl: "https://dev.azure.com/my-corp",
        project: "frontend-app",
      });
      expect(data.inferredName).toBe("web");
    });
  });
});
