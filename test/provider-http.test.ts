// test/provider-http.test.ts — Tests for Provider HTTP module behind all three adapters (#173).

import { describe, expect, it } from "bun:test";
import {
  AzureApiError,
  azureFetch,
  createAzureProvider,
  toUserError as toAzureUserError,
} from "../src/providers/azure-module.js";
import { GitHubHttpError } from "../src/providers/github/errors.js";
import { githubFetch } from "../src/providers/github/http.js";
import {
  ProviderHttpError,
  parseRetryAfter,
  providerFetch,
} from "../src/providers/http.js";
import {
  createJiraProvider,
  JiraHttpError,
  toJiraUserError,
} from "../src/providers/jira-module.js";
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

      const provider = createJiraProvider({ fetchFn: transport });

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
          fetchFn: slowTransport,
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
        providerFetch("https://example.com/err", { fetchFn: transport }),
      ).rejects.toBeInstanceOf(ProviderHttpError);

      await expect(
        providerFetch("https://example.com/signin", { fetchFn: transport }),
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
        fetchFn: transport,
        signal: controller.signal,
        timeoutMs: 2000,
      });

      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });

  describe("Review fixes (#173)", () => {
    function redirected(res: Response, url: string): Response {
      Object.defineProperty(res, "redirected", { value: true });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }

    describe("sign-in detection", () => {
      it("lets an adapter hook replace the built-in check", async () => {
        const fetchFn = async () =>
          htmlResponse("<html><body>Please sign in</body></html>");
        const res = await providerFetch("https://example.com/x", {
          fetchFn: fetchFn,
          isSignInRedirect: () => false,
        });
        expect(res.status).toBe(200);
        expect(res.text).toBe("<html><body>Please sign in</body></html>");
      });

      it("does not let GitHub throw on a 200 HTML response", async () => {
        const fetchFn = async () =>
          htmlResponse("<html><body>Sign in to GitHub</body></html>");
        const res = await githubFetch("https://api.github.com/x", {
          fetchFn: fetchFn,
        });
        expect(res.status).toBe(200);
      });

      it("classifies a 500 HTML error page by status, not as a sign-in", async () => {
        const fetchFn = async () =>
          htmlResponse(
            "<html><body>Server error, please log in later</body></html>",
            {
              status: 500,
            },
          );
        const err = await providerFetch("https://example.com/x", {
          fetchFn: fetchFn,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderHttpError);
        expect(err.status).toBe(500);
        expect(err.message).toBe("HTTP 500 error");
      });

      it("classifies a 400 HTML error page by status on Azure", async () => {
        const fetchFn = async () =>
          htmlResponse("<html><body>Bad request. Sign in again</body></html>", {
            status: 400,
          });
        const err = await azureFetch("https://dev.azure.com/x", {
          fetchFn,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(AzureApiError);
        expect(err.status).toBe(400);
        expect(err.isHtml).toBe(true);
        expect(toAzureUserError(err, "VERIFY").code).not.toBe("AUTH_INVALID");
      });

      it("does not treat a redirect to a repo named login-service as sign-in", async () => {
        const fetchFn = async () =>
          redirected(
            jsonResponse({ ok: true }),
            "https://api.github.com/repos/acme/login-service",
          );
        const res = await providerFetch("https://api.github.com/x", {
          fetchFn: fetchFn,
        });
        expect(res.status).toBe(200);
      });

      it("treats a redirect to login.microsoftonline.com as sign-in", async () => {
        const fetchFn = async () =>
          redirected(
            jsonResponse({ ok: true }),
            "https://login.microsoftonline.com/common/oauth2/authorize",
          );
        const err = await providerFetch("https://dev.azure.com/x", {
          fetchFn: fetchFn,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderHttpError);
        expect(err.isHtml).toBe(true);
      });

      it("treats a 302 with a /login Location as sign-in", async () => {
        const fetchFn = async () =>
          new Response("", {
            status: 302,
            headers: { location: "https://example.com/login?next=/x" },
          });
        const err = await providerFetch("https://example.com/x", {
          fetchFn: fetchFn,
        }).catch((e) => e);
        expect(err.message).toBe(
          "Authentication sign-in challenge or HTML redirect received",
        );
      });

      it("treats a 200 HTML sign-in page as sign-in by default", async () => {
        const fetchFn = async () =>
          htmlResponse("<html><body>Please sign in</body></html>");
        const err = await providerFetch("https://example.com/x", {
          fetchFn: fetchFn,
        }).catch((e) => e);
        expect(err.message).toBe(
          "Authentication sign-in challenge or HTML redirect received",
        );
      });
    });

    describe("GitHub error factory", () => {
      it("keeps isHtml and never uses the raw HTML page as the message", async () => {
        const fetchFn = async () =>
          htmlResponse("<html><body>Bad gateway</body></html>", {
            status: 502,
          });
        const err = await githubFetch("https://api.github.com/x", {
          fetchFn: fetchFn,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(GitHubHttpError);
        expect(err.status).toBe(502);
        expect(err.isHtml).toBe(true);
        expect(err.message).toBe("GitHub API request failed with HTTP 502");
      });

      it("keeps isTimeout and cause on a timeout", async () => {
        const fetchFn = createInMemoryTransport([
          {
            match: "/slow",
            handler: async () => {
              await new Promise((r) => setTimeout(r, 300));
              return jsonResponse({});
            },
          },
        ]);
        const pending = githubFetch("https://api.github.com/slow", {
          fetchFn: fetchFn,
          timeoutMs: 20,
        }).catch((e) => e);
        const err = await pending;
        expect(err).toBeInstanceOf(GitHubHttpError);
        expect(err.isTimeout).toBe(true);
        expect(err.cause).toBeDefined();
      });
    });

    describe("timeout and abort", () => {
      it("removes the abort listener when the call finishes", async () => {
        const controller = new AbortController();
        const removed: string[] = [];
        const original = controller.signal.removeEventListener.bind(
          controller.signal,
        );
        controller.signal.removeEventListener = ((
          type: string,
          ...rest: unknown[]
        ) => {
          removed.push(type);
          return (original as (...a: unknown[]) => void)(type, ...rest);
        }) as typeof controller.signal.removeEventListener;
        await providerFetch("https://example.com/x", {
          fetchFn: async () => jsonResponse({}),
          signal: controller.signal,
          timeoutMs: 1000,
        });
        expect(removed).toEqual(["abort"]);
      });

      it("propagates an already-aborted caller signal without calling the transport", async () => {
        const controller = new AbortController();
        controller.abort();
        let calls = 0;
        const err = await providerFetch("https://example.com/x", {
          fetchFn: async () => {
            calls += 1;
            return jsonResponse({});
          },
          signal: controller.signal,
          timeoutMs: 1000,
        }).catch((e) => e);
        expect(calls).toBe(0);
        expect(err).toBeInstanceOf(ProviderHttpError);
        expect(err.isTimeout).toBe(false);
      });

      it("does not report a caller abort as a timeout", async () => {
        const controller = new AbortController();
        const fetchFn = createInMemoryTransport([
          {
            match: "/hang",
            handler: async () => {
              await new Promise((r) => setTimeout(r, 300));
              return jsonResponse({});
            },
          },
        ]);
        const pending = providerFetch("https://example.com/hang", {
          fetchFn: fetchFn,
          signal: controller.signal,
          timeoutMs: 2000,
        }).catch((e) => e);
        controller.abort();
        const err = await pending;
        expect(err).toBeInstanceOf(ProviderHttpError);
        expect(err.isTimeout).toBe(false);
      });

      it("reports isTimeout only when our timer fired", async () => {
        const fetchFn = createInMemoryTransport([
          {
            match: "/hang",
            handler: async () => {
              await new Promise((r) => setTimeout(r, 300));
              return jsonResponse({});
            },
          },
        ]);
        const err = await providerFetch("https://example.com/hang", {
          fetchFn: fetchFn,
          timeoutMs: 20,
        }).catch((e) => e);
        expect(err.isTimeout).toBe(true);
      });

      it("gives GitHub requests a default timeout signal", async () => {
        let signal: AbortSignal | null | undefined;
        await githubFetch("https://api.github.com/x", {
          fetchFn: async (_i, init) => {
            signal = init?.signal;
            return jsonResponse({});
          },
        });
        expect(signal).toBeInstanceOf(AbortSignal);
      });

      it("gives Jira requests a default timeout signal", async () => {
        const signals: Array<AbortSignal | null | undefined> = [];
        const provider = createJiraProvider({
          fetchFn: async (_i, init) => {
            signals.push(init?.signal);
            return jsonResponse({ accountId: "a" });
          },
        });
        await provider
          .verifyCredentials({
            host: "acme.atlassian.net",
            email: "a@b.co",
            apiToken: "t",
          })
          .catch(() => undefined);
        expect(signals.length).toBeGreaterThan(0);
        for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
      });
    });

    describe("Jira error classification", () => {
      it("classifies by status, ignoring misleading message text", () => {
        const err = new JiraHttpError("401 unauthorized", 500);
        expect(toJiraUserError(err, "VERIFY").code).toBe("UNKNOWN");
      });

      it("falls back to the message only for errors without a status", () => {
        expect(toJiraUserError(new Error("HTTP 401"), "VERIFY").code).toBe(
          "AUTH_INVALID",
        );
        expect(toJiraUserError(new Error("Unauthorized"), "VERIFY").code).toBe(
          "AUTH_INVALID",
        );
      });

      it("does not match status digits inside longer numbers", () => {
        expect(
          toJiraUserError(new Error("job 4012 failed"), "VERIFY").code,
        ).toBe("UNKNOWN");
        expect(
          toJiraUserError(new Error("id 14290 missing"), "VERIFY").code,
        ).toBe("UNKNOWN");
      });
    });
  });
});
