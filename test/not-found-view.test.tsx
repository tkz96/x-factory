// test/not-found-view.test.tsx — The not-found screen (S-12). An address that
// matches no screen keeps the address the user typed and says so, rather than
// silently redirecting to Tickets; the one action leads back into the app.
//
// The seam is the real route table: the router is built from routeDefinitions
// and driven to a path no screen claims.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { NOT_FOUND_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { routeDefinitions } from "../src/frontend/routes.js";

const realFetch = globalThis.fetch;

afterAll(async () => {
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

/** Everything a query asks for answers an empty catalog. */
function stubFetch(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function renderMissingPage() {
  stubFetch();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routeDefinitions, {
    initialEntries: ["/no-such-page"],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

describe("the not-found screen (S-12)", () => {
  it("keeps the address the user typed instead of silently redirecting", () => {
    const { router } = renderMissingPage();

    expect(router.state.location.pathname).toBe("/no-such-page");
  });

  it("says the page does not exist, in the copy map's words", () => {
    const { getByRole, getByText } = renderMissingPage();

    expect(
      getByRole("heading", { name: NOT_FOUND_COPY.headline }),
    ).toBeTruthy();
    expect(getByText(NOT_FOUND_COPY.hint)).toBeTruthy();
  });

  it("offers the one way back into the app", () => {
    const { getByRole } = renderMissingPage();

    expect(
      getByRole("link", { name: NOT_FOUND_COPY.action }).getAttribute("href"),
    ).toBe("/tickets");
  });
});
