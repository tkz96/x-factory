// test/jira-provider.test.ts — Unit and contract integration tests for Jira Cloud provider (#140).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  hasCapability,
  isProviderError,
  REQUIRED_WORKFLOW_LABEL,
} from "../src/providers/contract.js";
import {
  type JiraConfig,
  JiraHttpError,
  jiraConfigSchema,
  jiraProvider,
  parseAdfToText,
  parseJiraQuickUrl,
  toJiraUserError,
} from "../src/providers/jira-module.js";
import { getProvider } from "../src/providers/registry.js";
import {
  serializeProvider,
  serializeProviderConfigSchema,
} from "../src/providers/serializer.js";
import { startServer } from "../src/server.js";

describe("Jira provider module (#140)", () => {
  describe("Registration & Identity", () => {
    it("is registered in the provider registry", () => {
      const provider = getProvider("jira");
      expect(provider).toBeDefined();
      expect(provider?.id).toBe("jira");
      expect(provider?.displayName).toBe("Jira Cloud");
      expect(provider?.roles).toEqual(["tracker"]);
      expect(provider?.iconRef).toBe("provider-jira");
    });

    it("declares roles as tracker only, never gitHost", () => {
      expect(jiraProvider.roles).toEqual(["tracker"]);
    });

    it("declares NO listRepositories capability (tracker, not a git host)", () => {
      expect(hasCapability(jiraProvider, "listRepositories")).toBe(false);
    });

    it("declares NO createPullRequest capability", () => {
      expect(hasCapability(jiraProvider, "createPullRequest")).toBe(false);
    });

    it("declares listTickets and parseQuickUrl capabilities", () => {
      expect(hasCapability(jiraProvider, "listTickets")).toBe(true);
      expect(hasCapability(jiraProvider, "parseQuickUrl")).toBe(true);
    });
  });

  describe("Config Schema & Serialization Gate", () => {
    it("validates full valid config", () => {
      const valid: JiraConfig = {
        host: "https://my-team.atlassian.net",
        email: "engineer@company.com",
        apiToken: "secret-token-xyz",
        project: "PROJ",
      };
      const parsed = jiraConfigSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it("allows optional project field to be omitted", () => {
      const valid = {
        host: "https://my-team.atlassian.net",
        email: "engineer@company.com",
        apiToken: "secret-token-xyz",
      };
      const parsed = jiraConfigSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.project).toBeUndefined();
      }
    });

    it("fails when required fields are missing", () => {
      expect(
        jiraConfigSchema.safeParse({
          host: "https://my-team.atlassian.net",
          email: "engineer@company.com",
        }).success,
      ).toBe(false);

      expect(
        jiraConfigSchema.safeParse({
          email: "engineer@company.com",
          apiToken: "secret-token",
        }).success,
      ).toBe(false);

      expect(
        jiraConfigSchema.safeParse({
          host: "https://my-team.atlassian.net",
          apiToken: "secret-token",
        }).success,
      ).toBe(false);
    });

    it("passes serialization gate without error", () => {
      const descriptors = serializeProviderConfigSchema(jiraConfigSchema);
      expect(descriptors).toEqual([
        {
          name: "host",
          label: "Jira Host",
          type: "url",
          required: true,
          placeholder: "https://your-domain.atlassian.net",
          help: "Base URL of your Jira Cloud instance (e.g. https://company.atlassian.net).",
        },
        {
          name: "email",
          label: "Email",
          type: "email",
          required: true,
          placeholder: "user@example.com",
          help: "Email address associated with your Atlassian account.",
        },
        {
          name: "apiToken",
          label: "API Token",
          type: "secret",
          required: true,
          secret: true,
          placeholder: "Atlassian API token",
          help: "Atlassian API token generated from your Atlassian account security settings.",
        },
        {
          name: "project",
          label: "Project Key",
          type: "text",
          required: false,
          placeholder: "e.g. PROJ",
          help: "Optional Jira project key to scope ticket queries.",
        },
      ]);
    });

    it("NEVER exposes envKey in serialized client-facing descriptors", () => {
      const descriptors = serializeProviderConfigSchema(jiraConfigSchema);
      for (const desc of descriptors) {
        expect("envKey" in desc).toBe(false);
      }
      const serialized = serializeProvider(jiraProvider);
      expect(serialized).not.toBeNull();
      const apiTokenField = serialized?.configFields.find(
        (f) => f.name === "apiToken",
      );
      expect(apiTokenField?.secret).toBe(true);
      expect("envKey" in (apiTokenField ?? {})).toBe(false);
    });
  });

  describe("Quick-URL Intake (parseQuickUrl)", () => {
    it("parses root atlassian.net URL", () => {
      const parsed = parseJiraQuickUrl("https://acme.atlassian.net");
      expect(parsed).toEqual({
        configDraft: {
          host: "https://acme.atlassian.net",
        },
        inferredName: "acme",
      });
    });

    it("parses URL with trailing slash", () => {
      const parsed = parseJiraQuickUrl("https://acme.atlassian.net/");
      expect(parsed).toEqual({
        configDraft: {
          host: "https://acme.atlassian.net",
        },
        inferredName: "acme",
      });
    });

    it("infers project key from /browse/PROJ-123 issue link", () => {
      const parsed = parseJiraQuickUrl(
        "https://example.atlassian.net/browse/PROJ-123",
      );
      expect(parsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
          project: "PROJ",
        },
        inferredName: "PROJ",
      });
    });

    it("infers project key from /projects/PROJ URL", () => {
      const parsed = parseJiraQuickUrl(
        "https://example.atlassian.net/projects/PROJ",
      );
      expect(parsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
          project: "PROJ",
        },
        inferredName: "PROJ",
      });
    });

    it("infers project key from /jira/software/projects/PROJ/boards/1 URL", () => {
      const parsed = parseJiraQuickUrl(
        "https://example.atlassian.net/jira/software/projects/PROJ/boards/1",
      );
      expect(parsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
          project: "PROJ",
        },
        inferredName: "PROJ",
      });
    });

    it("infers project key from /jira/software/c/projects/PROJ/boards/1 URL", () => {
      const parsed = parseJiraQuickUrl(
        "https://example.atlassian.net/jira/software/c/projects/PROJ/boards/1",
      );
      expect(parsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
          project: "PROJ",
        },
        inferredName: "PROJ",
      });
    });

    it("parses valid Jira URL with no project key and infers name from subdomain", () => {
      const parsed = parseJiraQuickUrl("https://example.atlassian.net");
      expect(parsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
        },
        inferredName: "example",
      });
      expect(parsed?.configDraft.project).toBeUndefined();

      const parsedSlash = parseJiraQuickUrl("https://example.atlassian.net/");
      expect(parsedSlash).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
        },
        inferredName: "example",
      });
      expect(parsedSlash?.configDraft.project).toBeUndefined();
    });

    it("does not infer project from project-like segment in an unrelated path", () => {
      const wikiParsed = parseJiraQuickUrl(
        "https://example.atlassian.net/wiki/spaces/projects/PROJ",
      );
      expect(wikiParsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
        },
        inferredName: "example",
      });
      expect(wikiParsed?.configDraft.project).toBeUndefined();

      const settingsParsed = parseJiraQuickUrl(
        "https://example.atlassian.net/settings/personal/projects/ABC",
      );
      expect(settingsParsed).toEqual({
        configDraft: {
          host: "https://example.atlassian.net",
        },
        inferredName: "example",
      });
      expect(settingsParsed?.configDraft.project).toBeUndefined();
    });

    it("returns null for non-atlassian domains", () => {
      expect(parseJiraQuickUrl("https://github.com/foo/bar")).toBeNull();
      expect(
        parseJiraQuickUrl("https://dev.azure.com/org/project/_git/repo"),
      ).toBeNull();
      expect(parseJiraQuickUrl("https://example.com")).toBeNull();
    });

    it("returns null for spoofed or attacker atlassian domain suffixes", () => {
      expect(
        parseJiraQuickUrl("https://evil.atlassian.net.attacker.com"),
      ).toBeNull();
      expect(
        parseJiraQuickUrl("https://atlassian.net.evil.org/browse/PROJ-1"),
      ).toBeNull();
    });

    it("returns null for malformed or invalid URL strings", () => {
      expect(parseJiraQuickUrl("")).toBeNull();
      expect(parseJiraQuickUrl("not a url")).toBeNull();
      expect(parseJiraQuickUrl("https://")).toBeNull();
    });
  });

  describe("CAPTCHA & Error Normalization (toUserError)", () => {
    it("maps CAPTCHA X-Seraph-LoginReason: AUTHENTICATION_DENIED to AUTH_LOCKED", () => {
      const headers = new Headers({
        "X-Seraph-LoginReason": "AUTHENTICATION_DENIED",
      });
      const error = new JiraHttpError("Locked out", 401, headers);
      const normalized = toJiraUserError(error, "VERIFY");

      expect(normalized).toEqual({
        code: "AUTH_LOCKED",
        context: "VERIFY",
      });
      expect(isProviderError(normalized)).toBe(true);
    });

    it("maps CAPTCHA header across all error contexts", () => {
      const headers = new Headers({
        "x-seraph-loginreason": "AUTHENTICATION_DENIED",
      });
      const error = new JiraHttpError("Locked", 403, headers);

      for (const ctx of ["VERIFY", "TICKETS", "DISCOVERY", "PR"] as const) {
        const norm = toJiraUserError(error, ctx);
        expect(norm.code).toBe("AUTH_LOCKED");
        expect(norm.context).toBe(ctx);
      }
    });

    it("maps 401 without CAPTCHA header to AUTH_INVALID", () => {
      const headers = new Headers();
      const error = new JiraHttpError("Unauthorized", 401, headers);
      const normalized = toJiraUserError(error, "VERIFY");

      expect(normalized).toEqual({
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
    });

    it("maps 403 without CAPTCHA header to PERMISSION", () => {
      const headers = new Headers();
      const error = new JiraHttpError("Forbidden", 403, headers);
      const normalized = toJiraUserError(error, "TICKETS");

      expect(normalized).toEqual({
        code: "PERMISSION",
        context: "TICKETS",
      });
    });

    it("maps 404 to NOT_FOUND", () => {
      const headers = new Headers();
      const error = new JiraHttpError("Not Found", 404, headers);
      const normalized = toJiraUserError(error, "VERIFY");

      expect(normalized).toEqual({
        code: "NOT_FOUND",
        context: "VERIFY",
      });
    });

    it("maps 429 with integer Retry-After to RATE_LIMITED with retryAfterMs", () => {
      const headers = new Headers({
        "Retry-After": "45",
      });
      const error = new JiraHttpError("Too Many Requests", 429, headers);
      const normalized = toJiraUserError(error, "TICKETS");

      expect(normalized).toEqual({
        code: "RATE_LIMITED",
        context: "TICKETS",
        retryAfterMs: 45000,
      });
    });

    it("maps 429 with HTTP date Retry-After to RATE_LIMITED with positive retryAfterMs", () => {
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const headers = new Headers({
        "Retry-After": futureDate,
      });
      const error = new JiraHttpError("Rate limited", 429, headers);
      const normalized = toJiraUserError(error, "TICKETS");

      expect(normalized.code).toBe("RATE_LIMITED");
      expect(normalized.context).toBe("TICKETS");
      expect(typeof normalized.retryAfterMs).toBe("number");
      expect(Number(normalized.retryAfterMs)).toBeGreaterThan(0);
    });

    it("maps 429 without Retry-After header to RATE_LIMITED without retryAfterMs", () => {
      const headers = new Headers();
      const error = new JiraHttpError("Rate limited", 429, headers);
      const normalized = toJiraUserError(error, "TICKETS");

      expect(normalized).toEqual({
        code: "RATE_LIMITED",
        context: "TICKETS",
      });
    });

    it("maps unknown error to UNKNOWN", () => {
      const error = new Error("DNS resolution failed");
      const normalized = toJiraUserError(error, "VERIFY");

      expect(normalized).toEqual({
        code: "UNKNOWN",
        context: "VERIFY",
      });
    });

    it("never leaks raw provider error text across boundary", () => {
      const error = new JiraHttpError(
        "Internal Jira database dump: secret table info",
        500,
        new Headers(),
      );
      const normalized = toJiraUserError(error, "VERIFY");
      expect(JSON.stringify(normalized)).not.toContain("database dump");
      expect(JSON.stringify(normalized)).not.toContain("secret table");
    });
  });

  describe("SEARCH -> SEARCH_JQL Capability Rename & Deprecation Remediation", () => {
    it("uses /rest/api/3/search/jql and never the deprecated /rest/api/3/search endpoint", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ issues: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      try {
        await jiraProvider.listTickets?.(
          {
            host: "https://test.atlassian.net",
            email: "test@example.com",
            apiToken: "token",
          },
          { requiredLabel: REQUIRED_WORKFLOW_LABEL },
        );

        expect(requestedUrl).toContain("/rest/api/3/search/jql");
        expect(requestedUrl).not.toContain("/rest/api/3/search?");
        expect(requestedUrl).not.toMatch(/\/rest\/api\/3\/search(?!\/jql)/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("ADF (Atlassian Document Format) Parsing", () => {
    it("extracts text from simple text node", () => {
      expect(parseAdfToText({ type: "text", text: "Hello World" })).toBe(
        "Hello World",
      );
    });

    it("extracts text from nested paragraphs and headings", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "heading",
            content: [{ type: "text", text: "Ticket Summary" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Fix the memory leak in worker." }],
          },
        ],
      };
      const text = parseAdfToText(doc);
      expect(text).toContain("Ticket Summary");
      expect(text).toContain("Fix the memory leak in worker.");
    });

    it("extracts bullet lists with dashes", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Criteria 1" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Criteria 2" }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const text = parseAdfToText(doc);
      expect(text).toContain("- Criteria 1");
      expect(text).toContain("- Criteria 2");
    });
  });

  describe("listTickets with REQUIRED_WORKFLOW_LABEL", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("filters by REQUIRED_WORKFLOW_LABEL by default and parses tickets", async () => {
      let capturedUrl = "";
      let capturedAuth = "";

      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedUrl = String(input);
        capturedAuth =
          (init?.headers as Record<string, string>)?.Authorization ?? "";

        return new Response(
          JSON.stringify({
            issues: [
              {
                key: "XF-101",
                fields: {
                  summary: "Implement Jira module",
                  description: {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            type: "text",
                            text: "Acceptance Criteria:\n- Clean implementation\n- Passes all gates",
                          },
                        ],
                      },
                    ],
                  },
                  labels: [REQUIRED_WORKFLOW_LABEL, "backend"],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const tickets = await jiraProvider.listTickets?.(
        {
          host: "https://acme.atlassian.net",
          email: "bot@acme.com",
          apiToken: "bot-token",
          project: "XF",
        },
        { requiredLabel: REQUIRED_WORKFLOW_LABEL },
      );

      expect(capturedUrl).toContain(
        encodeURIComponent(`labels = "${REQUIRED_WORKFLOW_LABEL}"`),
      );
      expect(capturedUrl).toContain(encodeURIComponent('project = "XF"'));
      expect(capturedAuth).toBe(
        `Basic ${Buffer.from("bot@acme.com:bot-token").toString("base64")}`,
      );

      expect(tickets).toBeDefined();
      expect(tickets).toHaveLength(1);
      const ticket = tickets?.[0];
      expect(ticket).toBeDefined();
      if (!ticket) throw new Error("Ticket expected");
      expect(ticket.id).toBe("XF-101");
      expect(ticket.title).toBe("Implement Jira module");
      expect(ticket.labels).toEqual([REQUIRED_WORKFLOW_LABEL, "backend"]);
      expect(ticket.url).toBe("https://acme.atlassian.net/browse/XF-101");
      expect(ticket.provider).toBe("jira");
      expect(ticket.acceptanceCriteria).toEqual([
        "Clean implementation",
        "Passes all gates",
      ]);
    });

    it("honors custom requiredLabel option", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ issues: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await jiraProvider.listTickets?.(
        {
          host: "https://acme.atlassian.net",
          email: "bot@acme.com",
          apiToken: "bot-token",
        },
        { requiredLabel: "custom-label" },
      );

      expect(capturedUrl).toContain(
        encodeURIComponent('labels = "custom-label"'),
      );
    });

    it("rejects hostile project key inputs before making any HTTP request", async () => {
      const hostileKeys = [
        'PROJ" OR project IS NOT EMPTY',
        "PROJ' OR ...",
        "PROJ-foo",
        "PROJ; DROP TABLE ...",
      ];

      for (const hostileKey of hostileKeys) {
        let fetchCalled = false;
        globalThis.fetch = (async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch;

        await expect(
          jiraProvider.listTickets?.(
            {
              host: "https://acme.atlassian.net",
              email: "bot@acme.com",
              apiToken: "bot-token",
              project: hostileKey,
            },
            { requiredLabel: "custom-label" },
          ),
        ).rejects.toThrow(/Invalid Jira project key format/);

        expect(fetchCalled).toBe(false);
      }
    });

    it("verifies multi-page search/jql pagination contract at the HTTP boundary", async () => {
      const capturedRequests: string[] = [];

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input.toString();
        capturedRequests.push(urlStr);

        if (capturedRequests.length === 1) {
          return new Response(
            JSON.stringify({
              nextPageToken: "cursor-token-page-2",
              issues: [
                { key: "T-1", fields: { summary: "First Page Item 1" } },
                { key: "T-2", fields: { summary: "First Page Item 2" } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (capturedRequests.length === 2) {
          return new Response(
            JSON.stringify({
              // Page 2 includes duplicate T-2 plus new T-3; no nextPageToken -> pagination terminates
              issues: [
                { key: "T-2", fields: { summary: "Duplicate Item 2" } },
                { key: "T-3", fields: { summary: "Second Page Item 3" } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        throw new Error("Unexpected third page request");
      }) as unknown as typeof fetch;

      const tickets = await jiraProvider.listTickets?.(
        {
          host: "https://acme.atlassian.net",
          email: "bot@acme.com",
          apiToken: "bot-token",
          project: "ENG",
        },
        { requiredLabel: REQUIRED_WORKFLOW_LABEL },
      );

      if (!tickets) {
        throw new Error("tickets should be defined");
      }

      // 1. First request uses maxResults=50 and no nextPageToken
      expect(capturedRequests).toHaveLength(2);
      const firstUrl = new URL(capturedRequests[0] ?? "");
      expect(firstUrl.searchParams.get("maxResults")).toBe("50");
      expect(firstUrl.searchParams.has("nextPageToken")).toBe(false);

      // 2 & 3. Second request triggered with returned nextPageToken and maxResults=50
      const secondUrl = new URL(capturedRequests[1] ?? "");
      expect(secondUrl.searchParams.get("maxResults")).toBe("50");
      expect(secondUrl.searchParams.get("nextPageToken")).toBe(
        "cursor-token-page-2",
      );

      // 4 & 6. Tickets from all pages returned and de-duplicated (T-1, T-2, T-3)
      expect(tickets).toHaveLength(3);
      expect(tickets.map((t) => t.id)).toEqual(["T-1", "T-2", "T-3"]);

      // 5. Pagination stopped when no token returned (only 2 requests)
      expect(capturedRequests).toHaveLength(2);
    });

    it("propagates HTTP failure on later pagination page using provider error mapping", async () => {
      let requestCount = 0;
      globalThis.fetch = (async () => {
        requestCount++;
        if (requestCount === 1) {
          return new Response(
            JSON.stringify({
              nextPageToken: "cursor-token-page-2",
              issues: [{ key: "T-1", fields: { summary: "First Page Item" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Page 2 fails with 403 Forbidden
        return new Response(JSON.stringify({ errorMessages: ["Forbidden"] }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      let caughtError: unknown;
      try {
        await jiraProvider.listTickets?.(
          {
            host: "https://acme.atlassian.net",
            email: "bot@acme.com",
            apiToken: "bot-token",
          },
          { requiredLabel: REQUIRED_WORKFLOW_LABEL },
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(JiraHttpError);
      expect((caughtError as JiraHttpError).status).toBe(403);

      const normalized = jiraProvider.toUserError(caughtError, "TICKETS");
      expect(normalized).toEqual({
        code: "PERMISSION",
        context: "TICKETS",
      });
      expect(isProviderError(normalized)).toBe(true);
    });

    it("throws JiraHttpError on initial HTTP failure", async () => {
      globalThis.fetch = (async () => {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" },
        });
      }) as unknown as typeof fetch;

      await expect(
        jiraProvider.listTickets?.(
          {
            host: "https://acme.atlassian.net",
            email: "bad@acme.com",
            apiToken: "bad-token",
          },
          { requiredLabel: REQUIRED_WORKFLOW_LABEL },
        ),
      ).rejects.toThrow(JiraHttpError);
    });
  });

  describe("verifyCredentials & Behavioral Probe Warnings", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns status 'ok' when credentials and BROWSE_PROJECTS probe succeed", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/rest/api/3/myself")) {
          return new Response(
            JSON.stringify({
              accountId: "acc-123",
              emailAddress: "bot@acme.com",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.includes("/rest/api/3/mypermissions")) {
          return new Response(
            JSON.stringify({
              permissions: {
                BROWSE_PROJECTS: {
                  havePermission: true,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const result = await jiraProvider.verifyCredentials({
        host: "https://acme.atlassian.net",
        email: "bot@acme.com",
        apiToken: "bot-token",
        project: "PROJ",
      });

      expect(result).toEqual({
        status: "ok",
        warnings: [],
      });
    });

    it("returns status 'degraded' with CAPABILITY_UNCONFIRMED warning when permission probe is false", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/rest/api/3/myself")) {
          return new Response(JSON.stringify({ accountId: "acc-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/rest/api/3/mypermissions")) {
          return new Response(
            JSON.stringify({
              permissions: {
                BROWSE_PROJECTS: {
                  havePermission: false,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const result = await jiraProvider.verifyCredentials({
        host: "https://acme.atlassian.net",
        email: "bot@acme.com",
        apiToken: "bot-token",
      });

      expect(result).toEqual({
        status: "degraded",
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "listTickets",
          },
        ],
      });
    });

    it("returns status 'degraded' when permission probe request fails", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/rest/api/3/myself")) {
          return new Response(JSON.stringify({ accountId: "acc-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/rest/api/3/mypermissions")) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const result = await jiraProvider.verifyCredentials({
        host: "https://acme.atlassian.net",
        email: "bot@acme.com",
        apiToken: "bot-token",
      });

      expect(result).toEqual({
        status: "degraded",
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "listTickets",
          },
        ],
      });
    });

    it("throws JiraHttpError when credentials endpoint /rest/api/3/myself fails", async () => {
      globalThis.fetch = (async () => {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" },
        });
      }) as unknown as typeof fetch;

      expect(
        jiraProvider.verifyCredentials({
          host: "https://acme.atlassian.net",
          email: "bot@acme.com",
          apiToken: "bad-token",
        }),
      ).rejects.toThrow(JiraHttpError);
    });
  });

  describe("API Surface Integration (#137 HTTP Endpoints)", () => {
    let server: ReturnType<typeof startServer>;
    let baseUrl: string;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      server = startServer(0);
      const port = server.port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(() => {
      server.stop();
      globalThis.fetch = originalFetch;
    });

    it("GET /api/providers/manifest includes Jira with roles and capabilities", async () => {
      const res = await fetch(`${baseUrl}/api/providers/manifest`);
      expect(res.status).toBe(200);
      const manifest = (await res.json()) as Array<{
        id: string;
        displayName: string;
        roles: string[];
        capabilities: string[];
        configFields: Array<{ name: string; required: boolean }>;
      }>;

      const jira = manifest.find((m) => m.id === "jira");
      expect(jira).toBeDefined();
      expect(jira?.displayName).toBe("Jira Cloud");
      expect(jira?.roles).toEqual(["tracker"]);
      expect(jira?.capabilities).toContain("listTickets");
      expect(jira?.capabilities).toContain("parseQuickUrl");
      expect(jira?.capabilities).not.toContain("listRepositories");
      expect(jira?.capabilities).not.toContain("createPullRequest");

      // Verify fields
      const fieldNames = jira?.configFields.map((f) => f.name);
      expect(fieldNames).toContain("host");
      expect(fieldNames).toContain("email");
      expect(fieldNames).toContain("apiToken");
      expect(fieldNames).toContain("project");
    });

    it("GET /api/providers/manifest respects role filtering", async () => {
      const trackerRes = await fetch(
        `${baseUrl}/api/providers/manifest?role=tracker`,
      );
      expect(trackerRes.status).toBe(200);
      const trackerManifest = (await trackerRes.json()) as Array<{
        id: string;
      }>;
      expect(trackerManifest.some((m) => m.id === "jira")).toBe(true);

      const gitHostRes = await fetch(
        `${baseUrl}/api/providers/manifest?role=git-host`,
      );
      expect(gitHostRes.status).toBe(200);
      const gitHostManifest = (await gitHostRes.json()) as Array<{
        id: string;
      }>;
      expect(gitHostManifest.some((m) => m.id === "jira")).toBe(false);
    });

    it("POST /api/providers/verify executes verifyCredentials and returns VerificationResult", async () => {
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const urlStr = String(input);
        if (urlStr.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        if (urlStr.includes("/rest/api/3/myself")) {
          return new Response(JSON.stringify({ accountId: "acc-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/rest/api/3/mypermissions")) {
          return new Response(
            JSON.stringify({
              permissions: { BROWSE_PROJECTS: { havePermission: true } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const res = await fetch(`${baseUrl}/api/providers/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "jira",
          role: "tracker",
          config: {
            host: "https://acme.atlassian.net",
            email: "bot@acme.com",
            apiToken: "valid-token",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: "ok",
        warnings: [],
      });
    });

    it("POST /api/providers/verify maps CAPTCHA lockout to AUTH_LOCKED envelope", async () => {
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const urlStr = String(input);
        if (urlStr.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        return new Response("Access Denied", {
          status: 403,
          headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" },
        });
      }) as typeof fetch;

      const res = await fetch(`${baseUrl}/api/providers/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "jira",
          config: {
            host: "https://acme.atlassian.net",
            email: "bot@acme.com",
            apiToken: "locked-token",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        code: "AUTH_LOCKED",
        context: "VERIFY",
      });
    });

    it("POST /api/providers/verify rejects incompatible role with 409", async () => {
      const res = await fetch(`${baseUrl}/api/providers/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "jira",
          role: "gitHost",
          config: {
            host: "https://acme.atlassian.net",
            email: "bot@acme.com",
            apiToken: "token",
          },
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { formErrors?: string[] };
      expect(body.formErrors).toEqual(["INCOMPATIBLE_CONFIGURATION"]);
    });

    it("POST /api/providers/verify rejects invalid config with 409 fieldErrors", async () => {
      const res = await fetch(`${baseUrl}/api/providers/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "jira",
          config: {
            host: "https://acme.atlassian.net",
            // missing email and apiToken
          },
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        fieldErrors?: Record<string, string>;
      };
      expect(body.fieldErrors?.email).toBe("REQUIRED");
      expect(body.fieldErrors?.apiToken).toBe("REQUIRED");
    });

    it("POST /api/providers/parse-url parses atlassian.net URLs via registered Jira provider", async () => {
      const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://myteam.atlassian.net/browse/CORE-456",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        matched: true,
        providerId: "jira",
        configDraft: {
          host: "https://myteam.atlassian.net",
          project: "CORE",
        },
        inferredName: "CORE",
      });
    });
  });
});
