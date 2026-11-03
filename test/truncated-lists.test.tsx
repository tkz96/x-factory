// test/truncated-lists.test.tsx — a list that is cut says how much it hides
// (#325): the ticket card and the command palette show "+N more".

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "../src/frontend/components/palette/CommandPalette.js";
import { TicketCard } from "../src/frontend/components/queue/TicketCard.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type { Project, Run, Ticket } from "../src/shared/types.js";

afterAll(async () => {
  await unregisterHappyDom();
});
afterEach(() => cleanup());

function renderIn(ui: React.ReactElement, seed: (c: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seed(client);
  return render(
    <QueryClientProvider client={client}>
      <ModalProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ModalProvider>
    </QueryClientProvider>,
  );
}

function card(over: Partial<Ticket>) {
  return (
    <TicketCard
      ticket={
        {
          id: "T-1",
          title: "A ticket",
          acceptanceCriteria: [],
          ...over,
        } as Ticket
      }
      projectId="p"
      runLink={{ kind: "none" } as never}
      workflowLabel=""
    />
  );
}

describe("TicketCard", () => {
  test("the external link names the provider by its display name", () => {
    const { container } = renderIn(
      card({ url: "https://x.example/1", provider: "github" }),
      (c) =>
        c.setQueryData(queryKeys.providers(), [
          {
            id: "github",
            displayName: "GitHub",
            roles: ["tracker"],
            iconRef: "i",
            capabilities: [],
            configFields: [],
          },
        ]),
    );
    expect(container.querySelector(".ticket-ext-link")?.textContent).toContain(
      "View on GitHub",
    );
  });

  test("criteria past the third say how many are hidden", () => {
    const { container } = renderIn(
      card({ acceptanceCriteria: ["a", "b", "c", "d", "e"] }),
      () => {},
    );
    expect(container.querySelector(".ticket-criteria")?.textContent).toContain(
      "+2 more",
    );
  });

  test("labels past the third say how many are hidden", () => {
    const { container } = renderIn(
      card({ labels: ["a", "b", "c", "d"] }),
      () => {},
    );
    expect(container.querySelector(".ticket-tags")?.textContent).toContain(
      "+1 more",
    );
  });

  test("a full list shows no +N more", () => {
    const { container } = renderIn(
      card({ acceptanceCriteria: ["a", "b", "c"], labels: ["a", "b", "c"] }),
      () => {},
    );
    expect(container.textContent).not.toContain("more");
  });
});

describe("CommandPalette", () => {
  test("runs past the 200 shown say how many are not listed", () => {
    const project = { id: "p", name: "P" } as Project;
    const runs = Array.from(
      { length: 203 },
      (_, i) =>
        ({
          id: `run-${i}`,
          project,
          ticket: { id: `T-${i}`, title: `Ticket ${i}`, acceptanceCriteria: [] },
          status: "awaiting_plan_approval",
          startedAt: "2026-10-01T00:00:00.000Z",
        }) as unknown as Run,
    );
    const { container } = renderIn(
      <CommandPalette
        isOpen
        onClose={() => {}}
        stopRunAvailable={false}
        onStopRun={() => {}}
        onOpenShortcuts={() => {}}
        onToggleAppearance={() => {}}
      />,
      (c) => {
        c.setQueryData(queryKeys.projects(), [project]);
        c.setQueryData(queryKeys.runs(), runs);
      },
    );
    expect(document.body.textContent).toContain("+3 more runs");
    expect(container).toBeTruthy();
  });
});
