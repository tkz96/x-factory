/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { runStatusText } from "../src/frontend/lib/run-status-ui.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import { TRANSITIONS } from "../src/shared/run-status-policy.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

describe("run status wording on screen", () => {
  it("the Runs list shows the plain label, never the raw status, for every status", () => {
    const statuses = Object.keys(TRANSITIONS) as RunStatus[];
    const runs = statuses.map(
      (status, i) =>
        ({
          id: `run-${status}`,
          status,
          branch: "b",
          startedAt: null,
          updatedAt: "2026-09-20T12:05:00.000Z",
          ticket: { id: `TICKET-${i}`, title: `Ticket number ${i}` },
          project: { id: "p", name: "P" },
        }) as unknown as Run,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.projects(), []);
    client.setQueryData(queryKeys.runs(), runs);
    const { container } = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          ModalProvider,
          null,
          createElement(
            MemoryRouter,
            { initialEntries: ["/runs?filter=all"] },
            createElement(ProjectProvider, null, createElement(RunsView)),
          ),
        ),
      ),
    );

    statuses.forEach((status, i) => {
      const card = container.querySelector(`a[href="/runs/run-${status}"]`);
      expect(card).not.toBeNull();
      const text = card?.textContent ?? "";
      expect(text).toContain(runStatusText(status));
      expect(text).not.toContain(status);
      // The card keeps the ticket details the run is recognised by.
      expect(text).toContain(`TICKET-${i}`);
      expect(text).toContain(`Ticket number ${i}`);
    });
  });
});
