// test/docs-scroll-behavior.test.tsx — The one scroll behaviour a programmatic
// scroll asks for. An in-page heading jump glides (the reader stays oriented);
// a reader who asked for reduced motion gets the instant jump, and a browser
// without matchMedia is never asked for a preference it cannot answer. Switching
// documents is a different thing: the pane's content is replaced, so it goes to
// the top at once instead of gliding over an article that is no longer there.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocsView } from "../src/frontend/views/DocsView.js";

const realFetch = globalThis.fetch;
const realMatchMedia = window.matchMedia;
const realScrollIntoView = Element.prototype.scrollIntoView;

/** Every `scrollIntoView` the screen asked for, in order. */
let scrollCalls: ScrollIntoViewOptions[] = [];

function spyOnScrollIntoView(): void {
  scrollCalls = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    if (typeof arg === "object") {
      scrollCalls.push(arg);
    }
  } as typeof Element.prototype.scrollIntoView;
}

/** matchMedia that answers the reduced-motion query and nothing else. */
function stubReducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && matches,
    media: query,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.matchMedia = realMatchMedia;
  Element.prototype.scrollIntoView = realScrollIntoView;
});

afterAll(async () => {
  await unregisterHappyDom();
});

const DOC = {
  category: "tutorials",
  slug: "first-agent-run",
  title: "Run Your First Agent Workflow",
  markdown:
    "# Tutorial: Run Your First Agent Workflow\n\n## Prerequisites\n\nBun and Git.\n",
};

/** Render the Docs screen with the tutorial above on screen. */
async function renderDoc() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DOC), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={["/docs?cat=tutorials&slug=first-agent-run"]}
      >
        <DocsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  // The table of contents only exists once the document has arrived.
  await waitFor(() =>
    expect(view.queryByRole("link", { name: "Prerequisites" })).not.toBeNull(),
  );
  return view;
}

/** Click the table of contents entry, as a reader would. */
async function jumpToPrerequisites() {
  const view = await renderDoc();
  spyOnScrollIntoView();
  const entry = view.getByRole("link", { name: "Prerequisites" });
  entry.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  return view;
}

describe("the Docs screen's programmatic scrolls", () => {
  it("glides to an in-page heading for a reader who asked for no preference", async () => {
    stubReducedMotion(false);
    await jumpToPrerequisites();

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(scrollCalls[0]?.block).toBe("start");
  });

  it("jumps instantly when the reader asked for reduced motion", async () => {
    stubReducedMotion(true);
    await jumpToPrerequisites();

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]?.behavior).toBe("auto");
  });

  it("keeps the smooth behaviour where the browser has no matchMedia", async () => {
    // A browser from before the API ignores the option anyway; what matters is
    // that the absent function is never called.
    delete (window as { matchMedia?: unknown }).matchMedia;
    await jumpToPrerequisites();

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]?.behavior).toBe("smooth");
  });

  it("replaces the pane at the top when a document is switched, with no glide", () => {
    // The sidebar's own scroll: the article it was gliding over is gone, so a
    // smooth scroll would animate an empty pane.
    const nav = readFileSync(
      "src/frontend/components/docs/DocsSidebarNav.tsx",
      "utf8",
    );
    expect(nav).toContain('scrollTo({ top: 0, behavior: "auto" })');
    expect(nav).not.toContain(
      "scrollTo({ top: 0, behavior: scrollBehavior() })",
    );
  });
});
