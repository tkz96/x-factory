// test/trackers.test.ts — Unit tests for issue tracker integration and criteria extraction.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  extractCriteria,
  fetchAzureTickets,
  fetchGitHubTickets,
  fetchJiraTickets,
  fetchProjectTickets,
  hasRequiredLabel,
  parseAdfToText,
  REQUIRED_WORKFLOW_LABEL,
  stripHtml,
} from "../src/trackers/index.js";
import type {
  AzureTrackerConfig,
  GitHubTrackerConfig,
  IssueTrackerProvider,
  JiraTrackerConfig,
} from "../src/types.js";

describe("Acceptance Criteria Extraction", () => {
  test("extracts criteria under dedicated header", () => {
    const body = `
### Background
We need to limit password reset attempts.

## Acceptance Criteria
- Return 429 Too Many Requests after 5 failed attempts
- Reset attempt counter after 15 minutes of inactivity
- [x] Send alert email to user on lock
- [ ] Add audit log entry for lockout

## Out of Scope
- Captcha integration
    `;

    const criteria = extractCriteria(body);
    expect(criteria).toEqual([
      "Return 429 Too Many Requests after 5 failed attempts",
      "Reset attempt counter after 15 minutes of inactivity",
      "Send alert email to user on lock",
      "Add audit log entry for lockout",
    ]);
  });

  test("extracts bullet points when no dedicated header exists", () => {
    const body = `
Fix checkout race condition.
* Acquire inventory lock before payment
* Release lock on failure
* Record trace ID
    `;
    const criteria = extractCriteria(body);
    expect(criteria).toEqual([
      "Acquire inventory lock before payment",
      "Release lock on failure",
      "Record trace ID",
    ]);
  });

  test("strips markdown formatting from criteria lines", () => {
    const body = `- Verify [link](https://example.com) and **bold** text in \`config.json\``;
    const criteria = extractCriteria(body);
    expect(criteria).toEqual(["Verify link and bold text in config.json"]);
  });

  test("returns empty array for empty or whitespace text", () => {
    expect(extractCriteria("")).toEqual([]);
    expect(extractCriteria("   \n\n  ")).toEqual([]);
  });
});

describe("Helper Utilities", () => {
  test("stripHtml cleans HTML markup and entities", () => {
    const html =
      "<p>First line<br/>Second line &amp; &lt;tag&gt;</p><ul><li>Item 1</li><li>Item 2</li></ul>";
    const text = stripHtml(html);
    expect(text).toContain("First line\nSecond line & <tag>");
    expect(text).toContain("- Item 1");
    expect(text).toContain("- Item 2");
  });

  test("parseAdfToText recursively extracts text from Jira ADF", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Implement token bucket rate limiter." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Maximum burst size: 10" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Refill rate: 1 token/sec" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const text = parseAdfToText(adf);
    expect(text).toContain("Implement token bucket rate limiter.");
    expect(text).toContain("- Maximum burst size: 10");
    expect(text).toContain("- Refill rate: 1 token/sec");
  });

  test("hasRequiredLabel matches case-insensitively", () => {
    expect(hasRequiredLabel(["bug", "agentic-workflow"])).toBe(true);
    expect(hasRequiredLabel(["Agentic-Workflow"])).toBe(true);
    expect(hasRequiredLabel(["AGENTIC-WORKFLOW"])).toBe(true);
    expect(hasRequiredLabel(["feature", "documentation"])).toBe(false);
  });
});

describe("GitHub Tracker (REST API)", () => {
  test("fetches and maps GitHub issues with required label", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      return new Response(
        JSON.stringify([
          {
            number: 42,
            title: "Add rate limiting",
            body: "## Acceptance Criteria\n- Max 10 requests per minute\n- Return Retry-After header",
            labels: [{ name: "agentic-workflow" }, { name: "backend" }],
            html_url: "https://github.com/example/repo/issues/42",
          },
          {
            number: 43,
            title: "Pull request should be ignored",
            body: "Ignore me",
            labels: [{ name: "agentic-workflow" }],
            html_url: "https://github.com/example/repo/pull/43",
            pull_request: {},
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    try {
      const tickets = await fetchGitHubTickets({
        repo: "example/repo",
        token: "fake-token",
        requiredLabel: REQUIRED_WORKFLOW_LABEL,
      });

      expect(tickets.length).toBe(1);
      const ticket = tickets[0];
      expect(ticket).toBeDefined();
      if (!ticket) return;
      expect(ticket.id).toBe("GH-42");
      expect(ticket.title).toBe("Add rate limiting");
      expect(ticket.provider).toBe("github");
      expect(ticket.acceptanceCriteria).toEqual([
        "Max 10 requests per minute",
        "Return Retry-After header",
      ]);
      expect(ticket.labels).toContain("agentic-workflow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws descriptive validation error on malformed GitHub API response", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      return new Response(JSON.stringify({ notAnArray: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await expect(
        fetchGitHubTickets({
          repo: "example/repo",
          token: "fake-token",
        }),
      ).rejects.toThrow("GitHub Issues API response validation failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Jira Tracker (REST v3)", () => {
  test("fetches and maps Jira issues with JQL", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          issues: [
            {
              key: "PROJ-101",
              fields: {
                summary: "Add webhook retry mechanism",
                description:
                  "Requirements:\n* Exponential backoff up to 5 attempts\n* Store dead letters in SQS",
                labels: ["agentic-workflow", "core"],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    try {
      const tickets = await fetchJiraTickets({
        host: "jira.example.com",
        email: "user@example.com",
        token: "jira-token",
        project: "PROJ",
      });

      expect(tickets.length).toBe(1);
      const ticket = tickets[0];
      expect(ticket).toBeDefined();
      if (!ticket) return;
      expect(ticket.id).toBe("PROJ-101");
      expect(ticket.title).toBe("Add webhook retry mechanism");
      expect(ticket.provider).toBe("jira");
      expect(ticket.acceptanceCriteria).toEqual([
        "Exponential backoff up to 5 attempts",
        "Store dead letters in SQS",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws descriptive validation error on malformed Jira API response", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      return new Response(
        JSON.stringify({ issues: [{ noKeyOrSummary: 123 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    try {
      await expect(
        fetchJiraTickets({
          host: "jira.example.com",
          email: "user@example.com",
          token: "jira-token",
        }),
      ).rejects.toThrow("Jira search API response validation failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Azure DevOps Tracker (WIQL)", () => {
  test("fetches and maps Azure DevOps work items", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // WIQL response
        return new Response(
          JSON.stringify({
            workItems: [{ id: 501 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      } else {
        // Work item batch details
        return new Response(
          JSON.stringify({
            value: [
              {
                id: 501,
                fields: {
                  "System.Title": "Migrate auth to OAuth2",
                  "System.Description": "<p>Update authentication flow.</p>",
                  "Microsoft.VSTS.Common.AcceptanceCriteria":
                    "<ul><li>Support PKCE flow</li><li>Rotate refresh tokens</li></ul>",
                  "System.Tags": "agentic-workflow; security",
                },
                _links: {
                  html: {
                    href: "https://dev.azure.com/org/proj/_workitems/edit/501",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    });

    try {
      const tickets = await fetchAzureTickets({
        orgUrl: "https://dev.azure.com/example-org",
        project: "example-proj",
        pat: "fake-pat",
      });

      expect(tickets.length).toBe(1);
      const ticket = tickets[0];
      expect(ticket).toBeDefined();
      if (!ticket) return;
      expect(ticket.id).toBe("AZ-501");
      expect(ticket.title).toBe("Migrate auth to OAuth2");
      expect(ticket.provider).toBe("azure");
      expect(ticket.acceptanceCriteria).toEqual([
        "Support PKCE flow",
        "Rotate refresh tokens",
      ]);
      expect(ticket.labels).toContain("agentic-workflow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws descriptive validation error on malformed Azure work items response", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ workItems: [{ id: 501 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ value: [{ id: "not-a-number" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await expect(
        fetchAzureTickets({
          orgUrl: "https://dev.azure.com/example-org",
          project: "example-proj",
          pat: "fake-pat",
        }),
      ).rejects.toThrow("Azure DevOps WorkItems response validation failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("fetchProjectTickets", () => {
    let originalProjectsJson: string | null = null;
    const projectsJsonPath = path.resolve(
      __dirname,
      "..",
      "config",
      "projects.json",
    );

    beforeAll(async () => {
      try {
        originalProjectsJson = await readFile(projectsJsonPath, "utf-8");
      } catch {
        // ignore
      }
    });

    afterAll(async () => {
      if (originalProjectsJson !== null) {
        await writeFile(projectsJsonPath, originalProjectsJson, "utf-8");
      }
    });

    test("throws error when project is not found", async () => {
      await expect(
        fetchProjectTickets("non-existent-project-id-999"),
      ).rejects.toThrow('Project "non-existent-project-id-999" not found');
    });

    test("throws error when project is archived", async () => {
      const { saveProject } = await import("../src/config.js");
      const archivedId = `archived-tracker-test-${Date.now()}`;
      await saveProject({
        id: archivedId,
        name: "Archived Project",
        archived: true,
        issueTracker: {
          provider: "azure",
          azure: {
            orgUrl: "https://dev.azure.com/org",
            project: "proj",
          },
        },
        repositories: [
          {
            id: `${archivedId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });

      await expect(fetchProjectTickets(archivedId)).rejects.toThrow(
        "is archived",
      );
    });

    test("throws error when Azure tracker configuration is incomplete", async () => {
      const { saveProject } = await import("../src/config.js");
      const incompleteId = `incomplete-tracker-test-${Date.now()}`;
      const azure: AzureTrackerConfig = {
        orgUrl: "",
        project: "",
      };
      await saveProject({
        id: incompleteId,
        name: "Incomplete Tracker Project",
        issueTracker: {
          provider: "azure",
          azure,
        },
        repositories: [
          {
            id: `${incompleteId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });

      await expect(fetchProjectTickets(incompleteId)).rejects.toThrow(
        "incomplete",
      );
    });

    test("throws error when Jira tracker configuration is incomplete", async () => {
      const { saveProject } = await import("../src/config.js");
      const jiraIncompleteId = `jira-incomplete-test-${Date.now()}`;
      await saveProject({
        id: jiraIncompleteId,
        name: "Jira Incomplete Project",
        issueTracker: {
          provider: "jira",
          jira: {
            host: "",
            email: "",
            project: "",
          },
        },
        repositories: [
          {
            id: `${jiraIncompleteId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });

      await expect(fetchProjectTickets(jiraIncompleteId)).rejects.toThrow(
        "Jira issue tracker configuration is incomplete",
      );
    });

    test("throws error when provider is unsupported", async () => {
      const { saveProject } = await import("../src/config.js");
      const unsupportedId = `unsupported-test-${Date.now()}`;
      await saveProject({
        id: unsupportedId,
        name: "Unsupported Tracker Project",
        issueTracker: {
          provider: "github",
        },
        repositories: [
          {
            id: `${unsupportedId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });

      await expect(
        fetchProjectTickets(unsupportedId, {
          provider: "unsupported-tracker" as unknown as IssueTrackerProvider,
        }),
      ).rejects.toThrow("Unsupported issue tracker provider");
    });

    test("fetches Jira tickets when configuration and credentials are provided", async () => {
      const { saveProject } = await import("../src/config.js");
      const { saveProjectEnv, PROJECT_ENV_KEYS } = await import(
        "../src/project-env.js"
      );
      const jiraId = `jira-valid-test-${Date.now()}`;
      const jira: JiraTrackerConfig = {
        host: "https://example.atlassian.net",
        email: "user@example.com",
        project: "PROJ",
      };
      await saveProject({
        id: jiraId,
        name: "Jira Valid Project",
        issueTracker: {
          provider: "jira",
          jira,
        },
        repositories: [
          {
            id: `${jiraId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });
      await saveProjectEnv(jiraId, {
        [PROJECT_ENV_KEYS.JIRA_TOKEN]: "valid-token",
      });

      const originalFetch = globalThis.fetch;
      (globalThis as Record<string, unknown>).fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            issues: [
              {
                id: "101",
                key: "PROJ-101",
                fields: {
                  summary: "Valid Jira Ticket",
                  description: "Acceptance criteria:\n- Test Jira",
                  labels: ["agentic-workflow"],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      try {
        const tickets = await fetchProjectTickets(jiraId);
        expect(tickets.length).toBe(1);
        expect(tickets[0]?.title).toBe("Valid Jira Ticket");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("fetches GitHub tickets for project with github tracker", async () => {
      const { saveProject } = await import("../src/config.js");
      const { saveProjectEnv, PROJECT_ENV_KEYS } = await import(
        "../src/project-env.js"
      );
      const ghId = `gh-valid-test-${Date.now()}`;
      const github: GitHubTrackerConfig = {
        repo: "org/my-test-repo",
      };
      await saveProject({
        id: ghId,
        name: "GitHub Valid Project",
        issueTracker: {
          provider: "github",
          github,
        },
        repositories: [
          {
            id: `${ghId}-r`,
            name: "r",
            path: "/tmp/r",
            defaultBranch: "main",
          },
        ],
      });
      await saveProjectEnv(ghId, {
        [PROJECT_ENV_KEYS.GITHUB_TOKEN]: "ghp_valid",
      });

      const originalFetch = globalThis.fetch;
      (globalThis as Record<string, unknown>).fetch = mock(async () => {
        return new Response(
          JSON.stringify([
            {
              id: 999,
              number: 42,
              title: "Valid GitHub Issue",
              body: "Criteria:\n- Test GH",
              html_url: "https://github.com/org/my-test-repo/issues/42",
              labels: [{ name: "agentic-workflow" }],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      try {
        const tickets = await fetchProjectTickets(ghId);
        expect(tickets.length).toBe(1);
        expect(tickets[0]?.title).toBe("Valid GitHub Issue");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
