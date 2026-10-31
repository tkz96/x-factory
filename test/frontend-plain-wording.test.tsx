// test/frontend-plain-wording.test.tsx — User-visible wording names the run, the
// ticket and the Builder/Reviewer roles; it never names the operator, the
// factory, the Ralph loop or the pipeline (#253, CONTEXT.md "UI wording").

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { RawLog } from "../src/frontend/components/runs/RawLog.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { RunCheckpointBar } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { runStatusUi } from "../src/frontend/lib/run-status-ui.js";
import { STAGE_LABELS } from "../src/frontend/lib/workflow-stages.js";
import { TRANSITIONS } from "../src/shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-09-20T12:34:56.000Z";
const ALL_STATUSES = Object.keys(TRANSITIONS) as RunStatus[];

/** The words that must never reach a screen. */
const INTERNAL_VOCABULARY = /\b(operator|factory|ralph|pipeline)\b/i;

function makeRun(status: RunStatus): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: {
      id: "T-1",
      title: "A ticket",
      url: "https://t",
      acceptanceCriteria: [],
    },
    plan: "the plan",
    branch: "b",
    status,
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
  } as Run;
}

describe("RunChat wording", () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: plain labels only, never the raw status or internal words`, () => {
      const events: RunEvent[] = [
        {
          id: 1,
          timestamp: AT,
          type: "status",
          payload: { status, text: "" },
        } as RunEvent,
      ];
      const { container } = render(
        <RunChat run={makeRun(status)} events={events} />,
      );
      const text = container.textContent ?? "";
      // The header strip's pill is the map's plain label; a run that waits on the reader says "Needs you".
      const ui = runStatusUi(status);
      expect(text).toContain(
        ui.filter === "Needs you" ? "Needs you" : ui.label,
      );
      expect(text).not.toMatch(INTERNAL_VOCABULARY);
      if (status.includes("_")) expect(text).not.toContain(status);
    });
  }

  it("says what the run is doing while it writes code", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Ralph");
    expect(text).toContain("Writing code");
  });

  it("says the run stopped without naming who stopped it", () => {
    const { container } = render(
      <RunChat run={makeRun("stopped")} events={[]} />,
    );
    expect(container.textContent).not.toContain("by operator");
  });
});

describe("RawLog wording", () => {
  it("shows a status event's plain label, never the raw status string", () => {
    const events: RunEvent[] = [
      {
        id: 1,
        timestamp: AT,
        type: "status",
        payload: { status: "awaiting_plan_approval", text: "Plan ready" },
      } as RunEvent,
    ];
    const { container } = render(<RawLog events={events} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Review the plan");
    expect(text).not.toContain("AWAITING_PLAN_APPROVAL");
    expect(text).not.toContain("awaiting_plan_approval");
  });

  it("shows a stage's plain label, never the raw stage id", () => {
    const events: RunEvent[] = [
      {
        id: 2,
        timestamp: AT,
        type: "stage_evidence",
        payload: { stage: "execute", evidence: "bun test passed" },
      } as RunEvent,
    ];
    const { container } = render(<RawLog events={events} />);
    const text = container.textContent ?? "";
    expect(text).toContain(STAGE_LABELS.execute);
    expect(text).not.toContain("EXECUTE");
  });

  it("names the roles doing the work, not the loop", () => {
    const events: RunEvent[] = [
      {
        id: 3,
        timestamp: AT,
        type: "ralph_progress",
        payload: { text: "writing the parser", iteration: 2 },
      } as RunEvent,
      {
        id: 4,
        timestamp: AT,
        type: "pi_output_chunk",
        payload: { role: "pi", text: "done" },
      } as RunEvent,
      {
        id: 5,
        timestamp: AT,
        type: "pi_output_chunk",
        payload: { role: "reviewer", text: "looks fine" },
      } as RunEvent,
    ];
    const { container } = render(<RawLog events={events} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(INTERNAL_VOCABULARY);
    expect(text).toContain("Builder");
    expect(text).toContain("Reviewer");
    expect(text).toContain("Progress");
  });

  it("waits for the first update in plain words", () => {
    const { container } = render(<RawLog events={[]} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(INTERNAL_VOCABULARY);
    expect(text).toContain("Waiting");
  });
});

describe("Checkpoint bar wording", () => {
  it("labels the checkpoint with the map's words and none of the old wording", () => {
    const { container } = render(
      React.createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
        },
        React.createElement(
          ModalProvider,
          null,
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(RunCheckpointBar, {
              status: "awaiting_review",
              pending: null,
              conflict: false,
              onAction: () => {},
            }),
          ),
        ),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Approve Changes");
    expect(text).toContain("Request Changes");
    expect(text).not.toContain("Request Rework");
    expect(text).not.toContain("Proceed to Delivery");
    expect(text).not.toContain("Session B");
    expect(text).not.toMatch(INTERNAL_VOCABULARY);
  });
});

describe("screens that show no internal vocabulary at all", () => {
  for (const file of [
    "src/frontend/views/RunDetailView.tsx",
    "src/frontend/views/RunsView.tsx",
    "src/frontend/components/runs/RunStageTimeline.tsx",
    // The first-run welcome (#269) speaks the same plain words.
    "src/frontend/views/WelcomeView.tsx",
    "src/frontend/components/welcome/SetupChecklist.tsx",
    "src/frontend/lib/setup-checklist.ts",
  ]) {
    it(`${file}`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(INTERNAL_VOCABULARY);
    });
  }
});

describe("AppShell wording", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Renders the shell against a readiness answer of the caller's choosing. */
  function renderWithReadiness(ready: boolean) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/readiness")
        ? { ready }
        : url.includes("/api/docs")
          ? { categories: [] }
          : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    return render(
      React.createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
        },
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/tickets"] },
          React.createElement(AppShell),
        ),
      ),
    );
  }

  it("says nothing in the toolbar while the workbench is ready", async () => {
    const view = renderWithReadiness(true);

    await waitFor(() =>
      expect(view.container.querySelector(".toolbar-search")).not.toBeNull(),
    );
    // No status readout at all when there is nothing to report (SYS-10), and
    // certainly not a word about the factory.
    expect(view.container.querySelector(".status-label")).toBeNull();
    expect(view.container.textContent ?? "").not.toMatch(INTERNAL_VOCABULARY);
  });

  it("offers one orange link to Settings › Diagnostics when the workbench is degraded", async () => {
    const view = renderWithReadiness(false);

    const link = await waitFor(() => {
      const found = view.container.querySelector(".toolbar-readiness");
      if (!found) throw new Error("no readiness link");
      return found as HTMLAnchorElement;
    });
    expect(link.getAttribute("href")).toBe("/settings?tab=diagnostics");
    expect(link.textContent?.trim()).toBe("Degraded");
    expect(link.textContent ?? "").not.toMatch(INTERNAL_VOCABULARY);
  });
});
