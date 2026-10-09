// test/ticket-normalization.test.ts — Ticket normalization module & cross-provider criteria equivalence (#185).

import { describe, expect, it } from "bun:test";
import { createAzureProvider } from "../src/providers/azure-module.js";
import { REQUIRED_WORKFLOW_LABEL } from "../src/providers/contract.js";
import { createGithubProvider } from "../src/providers/github-module.js";
import { createJiraProvider } from "../src/providers/jira-module.js";
import {
  extractAcceptanceCriteria,
  extractCriteria,
} from "../src/providers/ticket-normalization.js";
import {
  createInMemoryTransport,
  jsonResponse,
} from "./helpers/provider-test-helper.js";

describe("ticket-normalization module (extractAcceptanceCriteria)", () => {
  it("extracts bullet points under standard section headers", () => {
    const markdown = [
      "Summary of work to do.",
      "",
      "## Acceptance Criteria",
      "- Must not break the build",
      "* Must add tests",
      "+ Must pass linting",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(markdown);
    expect(criteria).toEqual([
      "Must not break the build",
      "Must add tests",
      "Must pass linting",
    ]);
  });

  it("extracts checkboxes and strips markdown links and styles", () => {
    const text = [
      "### Requirements:",
      "- [ ] See [Documentation](https://example.com) for setup",
      "- [x] Must support *dark mode* and `code`",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(text);
    expect(criteria).toEqual([
      "See Documentation for setup",
      "Must support dark mode and code",
    ]);
  });

  it("extracts numbered list items under section header", () => {
    const text = [
      "Criteria:",
      "1. First requirement",
      "2. Second requirement",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(text);
    expect(criteria).toEqual(["First requirement", "Second requirement"]);
  });

  it("stops extracting when encountering a subsequent section heading", () => {
    const text = [
      "## Acceptance Criteria",
      "- Valid criterion 1",
      "- Valid criterion 2",
      "",
      "## Out of Scope",
      "- Something else",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(text);
    expect(criteria).toEqual(["Valid criterion 1", "Valid criterion 2"]);
  });

  it("extracts bullets when no section header is present", () => {
    const text = ["- Direct bullet item 1", "- Direct bullet item 2"].join(
      "\n",
    );

    const criteria = extractAcceptanceCriteria(text);
    expect(criteria).toEqual(["Direct bullet item 1", "Direct bullet item 2"]);
  });

  it("returns empty array when text has no criteria or bullets", () => {
    const text =
      "This is a bug report with general description and no list items.";
    expect(extractAcceptanceCriteria(text)).toEqual([]);
    expect(extractAcceptanceCriteria("")).toEqual([]);
    expect(extractAcceptanceCriteria(null)).toEqual([]);
    expect(extractAcceptanceCriteria(undefined)).toEqual([]);
  });

  it("extractCriteria is an alias for extractAcceptanceCriteria", () => {
    expect(extractCriteria).toBe(extractAcceptanceCriteria);
  });
});

describe("cross-provider criteria equivalence at the provider transport seam (#185)", () => {
  it("yields identical criteria across GitHub, Jira, and Azure for section headers with bullets", async () => {
    const githubBody = [
      "Here is the issue description.",
      "",
      "## Acceptance Criteria",
      "- Must not break the build",
      "- Must add comprehensive tests",
    ].join("\n");

    const jiraAdf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Here is the issue description." }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Acceptance Criteria" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Must not break the build" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Must add comprehensive tests" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const azureHtml = [
      "<p>Here is the issue description.</p>",
      "<h2>Acceptance Criteria</h2>",
      "<ul>",
      "<li>Must not break the build</li>",
      "<li>Must add comprehensive tests</li>",
      "</ul>",
    ].join("");

    // GitHub transport
    const ghTransport = createInMemoryTransport([
      {
        match: "/issues",
        handler: jsonResponse([
          {
            number: 42,
            title: "Task 42",
            body: githubBody,
            state: "open",
            labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
            html_url: "https://github.com/org/repo/issues/42",
          },
        ]),
      },
    ]);
    const ghProvider = createGithubProvider({ fetchFn: ghTransport });
    const ghTickets = await ghProvider.listTickets?.(
      { token: "ghp_tok", repoOwner: "org", repository: "repo" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    // Jira transport
    const jiraTransport = createInMemoryTransport([
      {
        match: "/search/jql",
        handler: jsonResponse({
          issues: [
            {
              key: "PROJ-42",
              fields: {
                summary: "Task 42",
                description: jiraAdf,
                labels: [REQUIRED_WORKFLOW_LABEL],
              },
            },
          ],
        }),
      },
    ]);
    const jiraProviderInstance = createJiraProvider({ fetchFn: jiraTransport });
    const jiraTickets = await jiraProviderInstance.listTickets?.(
      {
        host: "https://test.atlassian.net",
        email: "user@test.com",
        apiToken: "tok",
        project: "PROJ",
      },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    // Azure transport
    const azureTransport = createInMemoryTransport([
      {
        match: "/_apis/wit/wiql",
        handler: jsonResponse({
          workItems: [{ id: 42 }],
        }),
      },
      {
        match: "/_apis/wit/workitems",
        handler: jsonResponse({
          value: [
            {
              id: 42,
              fields: {
                "System.Title": "Task 42",
                "System.Description": azureHtml,
                "System.Tags": REQUIRED_WORKFLOW_LABEL,
              },
            },
          ],
        }),
      },
    ]);
    const azureProviderInstance = createAzureProvider({
      fetchFn: azureTransport,
    });
    const azureTickets = await azureProviderInstance.listTickets?.(
      {
        orgUrl: "https://dev.azure.com/org",
        project: "proj",
        pat: "pat",
      },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const expected = [
      "Must not break the build",
      "Must add comprehensive tests",
    ];

    if (!ghTickets || !jiraTickets || !azureTickets) {
      throw new Error("Expected tickets to be defined");
    }

    expect(ghTickets[0]?.acceptanceCriteria).toEqual(expected);
    expect(jiraTickets[0]?.acceptanceCriteria).toEqual(expected);
    expect(azureTickets[0]?.acceptanceCriteria).toEqual(expected);
  });

  it("yields identical criteria across GitHub, Jira, and Azure for checkbox lists and link formatting", async () => {
    const githubBody = [
      "### Requirements:",
      "- [ ] See [Documentation](https://example.com) for setup",
      "- [x] Must support *dark mode*",
    ].join("\n");

    const jiraAdf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Requirements:\n- [ ] See [Documentation](https://example.com) for setup\n- [x] Must support *dark mode*",
            },
          ],
        },
      ],
    };

    const azureHtml = [
      "<h3>Requirements:</h3>",
      "<ul>",
      '<li>[ ] See <a href="https://example.com">Documentation</a> for setup</li>',
      "<li>[x] Must support *dark mode*</li>",
      "</ul>",
    ].join("");

    const ghTransport = createInMemoryTransport([
      {
        match: "/issues",
        handler: jsonResponse([
          {
            number: 10,
            title: "T-10",
            body: githubBody,
            state: "open",
            labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
            html_url: "https://github.com/org/repo/issues/10",
          },
        ]),
      },
    ]);
    const ghProvider = createGithubProvider({ fetchFn: ghTransport });
    const ghTickets = await ghProvider.listTickets?.(
      { token: "ghp_tok", repoOwner: "org", repository: "repo" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const jiraTransport = createInMemoryTransport([
      {
        match: "/search/jql",
        handler: jsonResponse({
          issues: [
            {
              key: "PROJ-10",
              fields: {
                summary: "T-10",
                description: jiraAdf,
                labels: [REQUIRED_WORKFLOW_LABEL],
              },
            },
          ],
        }),
      },
    ]);
    const jiraProviderInstance = createJiraProvider({ fetchFn: jiraTransport });
    const jiraTickets = await jiraProviderInstance.listTickets?.(
      {
        host: "https://test.atlassian.net",
        email: "user@test.com",
        apiToken: "tok",
        project: "PROJ",
      },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const azureTransport = createInMemoryTransport([
      {
        match: "/_apis/wit/wiql",
        handler: jsonResponse({ workItems: [{ id: 10 }] }),
      },
      {
        match: "/_apis/wit/workitems",
        handler: jsonResponse({
          value: [
            {
              id: 10,
              fields: {
                "System.Title": "T-10",
                "System.Description": azureHtml,
                "System.Tags": REQUIRED_WORKFLOW_LABEL,
              },
            },
          ],
        }),
      },
    ]);
    const azureProviderInstance = createAzureProvider({
      fetchFn: azureTransport,
    });
    const azureTickets = await azureProviderInstance.listTickets?.(
      { orgUrl: "https://dev.azure.com/org", project: "proj", pat: "pat" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const expected = ["See Documentation for setup", "Must support dark mode"];

    if (!ghTickets || !jiraTickets || !azureTickets) {
      throw new Error("Expected tickets to be defined");
    }

    expect(ghTickets[0]?.acceptanceCriteria).toEqual(expected);
    expect(jiraTickets[0]?.acceptanceCriteria).toEqual(expected);
    expect(azureTickets[0]?.acceptanceCriteria).toEqual(expected);
  });

  it("yields empty criteria across all three providers for tickets without criteria", async () => {
    const ghTransport = createInMemoryTransport([
      {
        match: "/issues",
        handler: jsonResponse([
          {
            number: 99,
            title: "Plain issue",
            body: "Just an open discussion without criteria or bullet points.",
            state: "open",
            labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
            html_url: "https://github.com/org/repo/issues/99",
          },
        ]),
      },
    ]);
    const ghTickets = await createGithubProvider({
      fetchFn: ghTransport,
    }).listTickets?.(
      { token: "ghp_tok", repoOwner: "org", repository: "repo" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const jiraTransport = createInMemoryTransport([
      {
        match: "/search/jql",
        handler: jsonResponse({
          issues: [
            {
              key: "PROJ-99",
              fields: {
                summary: "Plain issue",
                description:
                  "Just an open discussion without criteria or bullet points.",
                labels: [REQUIRED_WORKFLOW_LABEL],
              },
            },
          ],
        }),
      },
    ]);
    const jiraTickets = await createJiraProvider({
      fetchFn: jiraTransport,
    }).listTickets?.(
      {
        host: "https://test.atlassian.net",
        email: "u@t.com",
        apiToken: "t",
        project: "PROJ",
      },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    const azureTransport = createInMemoryTransport([
      {
        match: "/_apis/wit/wiql",
        handler: jsonResponse({ workItems: [{ id: 99 }] }),
      },
      {
        match: "/_apis/wit/workitems",
        handler: jsonResponse({
          value: [
            {
              id: 99,
              fields: {
                "System.Title": "Plain issue",
                "System.Description":
                  "<p>Just an open discussion without criteria or bullet points.</p>",
                "System.Tags": REQUIRED_WORKFLOW_LABEL,
              },
            },
          ],
        }),
      },
    ]);
    const azureTickets = await createAzureProvider({
      fetchFn: azureTransport,
    }).listTickets?.(
      { orgUrl: "https://dev.azure.com/org", project: "proj", pat: "pat" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    if (!ghTickets || !jiraTickets || !azureTickets) {
      throw new Error("Expected tickets to be defined");
    }

    expect(ghTickets[0]?.acceptanceCriteria).toEqual([]);
    expect(jiraTickets[0]?.acceptanceCriteria).toEqual([]);
    expect(azureTickets[0]?.acceptanceCriteria).toEqual([]);
  });
});
