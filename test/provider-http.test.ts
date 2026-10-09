// test/provider-http.test.ts — Tests for Provider HTTP module behind all three adapters (#173).

import { describe, expect, it } from "bun:test";
import {
  AzureApiError,
  createAzureProvider,
  toUserError as toAzureUserError,
} from "../src/providers/azure-module.js";
import {
  ProviderHttpError,
  parseRetryAfter,
  providerFetch,
} from "../src/providers/http.js";
import { createJiraProvider } from "../src/providers/jira-module.js";
import {
  createInMemoryTransport,
  htmlResponse,
  jsonResponse,
  textResponse,
} from "./helpers/provider-test-helper.js";

describe("Provider HTTP Module (#173)", () => {
  describe("Acceptance Criterion 1: Jira tested without touching globalThis.fetch", () => {
    it("runs verifyCredentials and listTickets via in-memory transport without mutating globalThis.fetch", async () => {
      const originalFetch = globalThis.fetch;

      const transport = createInMemoryTransport([
        {
          match: "/rest/api/3/myself",
          handler: jsonResponse({
            accountId: "acc-123",
            emailAddress: "dev@example.com",
          }),
        },
        {
          match: "/rest/api/3/mypermissions",
          handler: jsonResponse({
            permissions: {
              BROWSE_PROJECTS: { havePermission: true },
            },
          }),
        },
        {
          match: "/rest/api/3/search/jql",
          handler: jsonResponse({
            issues: [
              {
                key: "XF-10",
                fields: {
                  summary: "First Jira Ticket",
                  description: "Implement feature",
                  labels: ["x-factory"],
                },
              },
            ],
          }),
        },
      ]);

      const provider = createJiraProvider({ transport });

      const verifyResult = await provider.verifyCredentials({
        host: "https://my-team.atlassian.net",
        email: "dev@example.com",
        apiToken: "valid-token",
        project: "XF",
      });
      expect(verifyResult.status).toBe("ok");

      if (!provider.listTickets) {
        throw new Error("listTickets capability missing");
      }

      const tickets = await provider.listTickets(
        {
          host: "https://my-team.atlassian.net",
          email: "dev@example.com",
          apiToken: "valid-token",
          project: "XF",
        },
        { requiredLabel: "x-factory" },
      );

      expect(tickets).toHaveLength(1);
      expect(tickets[0]?.id).toBe("XF-10");
      expect(tickets[0]?.title).toBe("First Jira Ticket");

      // Prove globalThis.fetch was never touched
      expect(globalThis.fetch).toBe(originalFetch);
    });
  });

  describe("Acceptance Criterion 2: Azure scope verification detects sign-in redirect and times out", () => {
    it("detects sign-in redirect on 200 HTML and marks listTickets as unconfirmed rather than confirmed", async () => {
      const transport = createInMemoryTransport([
        {
          match: "/_apis/wit/wiql",
          handler: htmlResponse(
            "<!doctype html><html><head><title>Sign in to your account</title></head><body>Login required</body></html>",
            { status: 200 },
          ),
        },
        {
          match: "/_apis/git/repositories",
          handler: jsonResponse({ value: [] }),
        },
      ]);

      const provider = createAzureProvider({ fetchFn: transport });
      if (!provider.verifyScopes) {
        throw new Error("verifyScopes capability missing");
      }

      const report = await provider.verifyScopes({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProj",
        pat: "secret-pat",
      });

      const ticketFinding = report.findings.find(
        (f) => f.capability === "listTickets",
      );
      expect(ticketFinding).toBeDefined();
      expect(ticketFinding?.status).toBe("unconfirmed");
    });

    it("times out during scope verification when probe hangs, marking capability as unconfirmed", async () => {
      const transport = createInMemoryTransport([
        {
          match: "/_apis/wit/wiql",
          handler: async () => {
            // Hang indefinitely until abort signal fires
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            return jsonResponse({ workItems: [] });
          },
        },
        {
          match: "/_apis/git/repositories",
          handler: jsonResponse({ value: [] }),
        },
      ]);

      const provider = createAzureProvider({
        fetchFn: transport,
        probeTimeoutMs: 50,
      });
      if (!provider.verifyScopes) {
        throw new Error("verifyScopes capability missing");
      }

      const report = await provider.verifyScopes({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProj",
        pat: "secret-pat",
      });

      const ticketFinding = report.findings.find(
        (f) => f.capability === "listTickets",
      );
      expect(ticketFinding).toBeDefined();
      expect(ticketFinding?.status).toBe("unconfirmed");
    });
  });

  describe("Acceptance Criterion 3: 400 or 500 containing 'path' or 'author' is not classified as auth failure", () => {
    it("does not classify HTTP 400 with 'path' in body or message as AUTH_INVALID", () => {
      const error400 = new AzureApiError(
        "Invalid path parameter: repository path does not exist",
        {
          status: 400,
          bodyText: '{"message":"Invalid path: /src/app"}',
        },
      );

      const userError = toAzureUserError(error400, "VERIFY");
      expect(userError.code).toBe("UNKNOWN");
      expect(userError.code).not.toBe("AUTH_INVALID");
    });

    it("does not classify HTTP 500 with 'author' in body or message as AUTH_INVALID", () => {
      const error500 = new AzureApiError(
        "Internal server error: author resolution failed in commit service",
        {
          status: 500,
          bodyText: '{"error":"author metadata not found"}',
        },
      );

      const userError = toAzureUserError(error500, "VERIFY");
      expect(userError.code).toBe("UNKNOWN");
      expect(userError.code).not.toBe("AUTH_INVALID");
    });
  });

  describe("Acceptance Criterion 4: Retry-After parsed one way for all providers", () => {
    it("parses integer and decimal seconds to positive milliseconds", () => {
      expect(parseRetryAfter("60")).toBe(60_000);
      expect(parseRetryAfter("120")).toBe(120_000);
      expect(parseRetryAfter("1.5")).toBe(1_500);
    });

    it("parses future HTTP dates to milliseconds diff", () => {
      const futureDate = new Date(Date.now() + 30_000).toUTCString();
      const parsed = parseRetryAfter(futureDate);
      expect(typeof parsed).toBe("number");
      expect(parsed).toBeGreaterThan(20_000);
      expect(parsed).toBeLessThanOrEqual(30_000);
    });

    it("returns undefined for missing, non-positive, past dates, or invalid values", () => {
      expect(parseRetryAfter(undefined)).toBeUndefined();
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter("")).toBeUndefined();
      expect(parseRetryAfter("0")).toBeUndefined();
      expect(parseRetryAfter("-10")).toBeUndefined();
      expect(parseRetryAfter("invalid-format")).toBeUndefined();

      const pastDate = new Date(Date.now() - 10_000).toUTCString();
      expect(parseRetryAfter(pastDate)).toBeUndefined();
    });

    it("accepts a Headers object directly", () => {
      const headers = new Headers();
      headers.set("retry-after", "45");
      expect(parseRetryAfter(headers)).toBe(45_000);
    });
  });

  describe("Acceptance Criterion 5: Shared test helper replaces inline Response construction", () => {
    it("creates jsonResponse with proper headers and status", async () => {
      const res = jsonResponse({ ok: true }, { status: 201 });
      expect(res.status).toBe(201);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ ok: true });
    });

    it("creates textResponse with status", async () => {
      const res = textResponse("hello", { status: 400 });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("hello");
    });

    it("creates htmlResponse with text/html content-type", async () => {
      const res = htmlResponse("<h1>Title</h1>", { status: 200 });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(await res.text()).toBe("<h1>Title</h1>");
    });

    it("aborts and throws ProviderHttpError when timeoutMs expires", async () => {
      const slowTransport = createInMemoryTransport([
        {
          match: "/timeout-test",
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return jsonResponse({ ok: true });
          },
        },
      ]);
      await expect(
        providerFetch("https://example.com/timeout-test", {
          transport: slowTransport,
          timeoutMs: 20,
        }),
      ).rejects.toThrow(/timed out/i);
    });

    it("throws ProviderHttpError with default error factory on HTTP error and signin", async () => {
      const transport = createInMemoryTransport([
        {
          match: "/err",
          handler: jsonResponse({ message: "Bad Request" }, { status: 400 }),
        },
        {
          match: "/signin",
          handler: htmlResponse("<html><body>Sign In</body></html>", {
            status: 200,
          }),
        },
      ]);

      await expect(
        providerFetch("https://example.com/err", { transport }),
      ).rejects.toBeInstanceOf(ProviderHttpError);

      await expect(
        providerFetch("https://example.com/signin", { transport }),
      ).rejects.toBeInstanceOf(ProviderHttpError);
    });

    it("wires external signal together with timeoutMs", async () => {
      const controller = new AbortController();
      const transport = createInMemoryTransport([
        {
          match: "/hang",
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return jsonResponse({ ok: true });
          },
        },
      ]);

      const promise = providerFetch("https://example.com/hang", {
        transport,
        signal: controller.signal,
        timeoutMs: 2000,
      });

      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });
});
