// test/docs-one-heading.test.tsx — One heading level 1 on the Docs screen
// (#258, spec #241). A reader who jumps by heading must land on one title,
// whether the screen shows a document or a credentials pane.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocsView } from "../src/frontend/views/DocsView.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await unregisterHappyDom();
});

const DOC = {
  category: "tutorials",
  slug: "first-agent-run",
  title: "Run Your First Agent Workflow",
  markdown: "# Tutorial: Run Your First Agent Workflow\n\n## Prerequisites\n",
};

function stubFetch() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DOC), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function renderDocs(path: string) {
  stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DocsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The headings level 1 on the screen, in document order. */
function h1s(): string[] {
  return Array.from(document.querySelectorAll("h1")).map(
    (heading) => heading.textContent ?? "",
  );
}

describe("Docs renders one heading level 1 per screen (#258)", () => {
  it("renders the document's own title as the only h1", async () => {
    renderDocs("/docs?cat=tutorials&slug=first-agent-run");
    await waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
    expect(h1s()).toEqual(["Tutorial: Run Your First Agent Workflow"]);
  });

  for (const [section, title, id] of [
    [
      "least-privilege",
      "Principle of Least Privilege",
      "least-privilege-overview",
    ],
    ["azure", "Azure DevOps Token Scopes", "azure-pat-scopes"],
    ["github", "GitHub Personal Access Token", "github-pat"],
    ["gitlab", "GitLab Access Token", "gitlab-pat"],
    ["jira", "Atlassian Jira API Token", "jira-token"],
  ] as const) {
    it(`renders the ${section} pane as the only h1, with its table-of-contents id`, () => {
      renderDocs(`/docs?cat=security&slug=${section}`);
      expect(h1s()).toEqual([title]);
      // The table of contents and a deep link both address the pane by this id.
      expect(document.getElementById(id)?.textContent).toBe(title);
    });
  }
});
