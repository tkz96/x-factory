// test/run-chat-panel.test.tsx — The run chat as the left panel of the run page: its header strip (status
// pill, elapsed time, stages done, Expand all / Collapse all), the decision card inside the current stage,
// and the message box's tips button, labelled and described by its tooltip (spec "Left panel").

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-10-20T10:00:00.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-panel",
    project: { id: "p", name: "P" },
    ticket: {
      id: "T-1",
      title: "A ticket",
      url: "https://t",
      acceptanceCriteria: [],
    },
    plan: "",
    branch: "factory/t-1",
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
    ...overrides,
  } as Run;
}

function statusEvent(id: number, status: RunStatus, at: string): RunEvent {
  return {
    id,
    type: "status",
    payload: { status, text: "" },
    timestamp: at,
  } as unknown as RunEvent;
}

/** A run that has passed prepare and understand and plan, and now writes code. */
function executingEvents(): RunEvent[] {
  return [
    statusEvent(1, "understanding", "2026-10-20T10:00:10.000Z"),
    statusEvent(2, "planning", "2026-10-20T10:01:00.000Z"),
    statusEvent(3, "executing", "2026-10-20T10:02:00.000Z"),
  ];
}

function stageHeaders(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button.run-stage-header"),
  );
}

describe("the header strip", () => {
  it("shows the status pill in the map's words, the Needs you tone for a run that waits", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    const pill = within(strip).getByText("Needs you").closest(".ui-badge");
    expect(pill?.className).toContain("ui-badge--warning");
    // The blinking dot is decorative and says nothing to a screen reader.
    expect(
      strip.querySelector(".run-chat-status-dot")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("shows the plain label of an active run, with no waiting dot", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    expect(within(strip).getByText("Writing code")).toBeTruthy();
    expect(strip.querySelector(".run-chat-status-dot")).toBeNull();
  });

  it("says Waiting for the worker, not the stage, while no worker has claimed the job", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing", { waitingForWorker: true })}
        events={[]}
      />,
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    expect(within(strip).getByText("Waiting for the worker")).toBeTruthy();
    expect(within(strip).queryByText("Writing code")).toBeNull();
  });

  it("keeps the stage label once a worker holds the job", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing", { waitingForWorker: false })}
        events={[]}
      />,
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    expect(within(strip).getByText("Writing code")).toBeTruthy();
  });

  it("shows the elapsed time since the run started, with tabular figures", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    const elapsed = container.querySelector(".run-chat-elapsed");
    expect(elapsed?.textContent).toMatch(/\d+s$|\d+m \d+s$|\dh \d+m$/);
  });

  it("counts the stages done, in muted words", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={executingEvents()} />,
    );
    const count = container.querySelector(".run-chat-progress-count");
    expect(count?.textContent).toBe("3 of 6 stages done");
  });

  it("opens every stage with Expand all, then closes every stage with Collapse all", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={executingEvents()} />,
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    // Only the current stage is open at first.
    expect(
      stageHeaders(container).map((b) => b.getAttribute("aria-expanded")),
    ).toEqual(["false", "false", "false", "true", "false", "false"]);

    const expand = within(strip).getByRole("button", { name: "Expand all" });
    fireEvent.click(expand);
    expect(
      stageHeaders(container).every(
        (b) => b.getAttribute("aria-expanded") === "true",
      ),
    ).toBe(true);

    const collapse = within(strip).getByRole("button", {
      name: "Collapse all",
    });
    fireEvent.click(collapse);
    expect(
      stageHeaders(container).every(
        (b) => b.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
  });

  it("toggles one stage without touching the others, and keeps the reader's choice", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={executingEvents()} />,
    );
    const prepare = stageHeaders(container)[0] as HTMLButtonElement;
    fireEvent.click(prepare);
    expect(prepare.getAttribute("aria-expanded")).toBe("true");
    expect(stageHeaders(container)[3]?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});

describe("the header strip at phone width", () => {
  /** Stubs matchMedia so the phone query matches, then restores it. */
  function atPhoneWidth<T>(run: () => T): T {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(max-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      return run();
    } finally {
      window.matchMedia = original;
    }
  }

  it("drops the stages-done count and makes Expand all an icon button with its name", () => {
    const { container } = atPhoneWidth(() =>
      render(<RunChat run={makeRun("executing")} events={executingEvents()} />),
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    expect(container.querySelector(".run-chat-progress-count")).toBeNull();
    expect(strip.querySelector("button.run-chat-expand-icon")).not.toBeNull();
    const expand = within(strip).getByRole("button", { name: "Expand all" });
    fireEvent.click(expand);
    expect(
      stageHeaders(container).every(
        (b) => b.getAttribute("aria-expanded") === "true",
      ),
    ).toBe(true);
    const collapse = within(strip).getByRole("button", {
      name: "Collapse all",
    });
    expect(collapse.className).toContain("run-chat-expand-open");
  });

  it("holds the Details trigger at the end of the strip", () => {
    const { container } = atPhoneWidth(() =>
      render(
        <RunChat
          run={makeRun("executing")}
          events={[]}
          detailsTrigger={
            <button type="button" aria-label="Details">
              i
            </button>
          }
        />,
      ),
    );
    const strip = container.querySelector(".run-chat-header") as HTMLElement;
    const details = within(strip).getByRole("button", { name: "Details" });
    expect(details.parentElement).toBe(strip);
    expect(strip.lastElementChild).toBe(details);
  });

  it("keeps the full Expand all text and the count above the phone width", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={executingEvents()} />,
    );
    expect(
      container.querySelector(".run-chat-progress-count")?.textContent,
    ).toBe("3 of 6 stages done");
    expect(container.querySelector("button.run-chat-expand-icon")).toBeNull();
  });
});

describe("the decision card", () => {
  it("sits inside the current stage, with the checkpoint buttons", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.closest('li.run-stage[data-state="current"]')).not.toBeNull();
    expect(
      within(card).getByRole("button", { name: "Approve Plan" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Request Changes" }),
    ).toBeTruthy();
  });

  it("is absent on an active run that has nothing to decide", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    expect(container.querySelector(".run-decision")).toBeNull();
  });

  it("shows a failed run's failure and its recovery in the stage it failed in", () => {
    const failure = {
      category: "model",
      message: "The model call failed.",
      recovery: "Check the model connection in Settings, then restart the run.",
    };
    const { container } = render(
      <RunChat
        run={makeRun("failed")}
        events={[
          executingEvents()[0] as RunEvent,
          {
            id: 9,
            type: "status",
            payload: { status: "failed", failure },
            timestamp: "2026-10-20T10:05:00.000Z",
          } as unknown as RunEvent,
        ]}
      />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText("The model call failed.")).toBeTruthy();
    expect(card.closest('li.run-stage[data-state="failed"]')).not.toBeNull();
  });
});

describe("the message box's tips button", () => {
  it("is labelled Message Tips and describes the textarea keys on focus", async () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const tips = within(container).getByRole("button", {
      name: "Message Tips",
    });
    expect(tips).toBeTruthy();

    act(() => {
      (tips as HTMLButtonElement).focus();
    });

    const tooltip = await waitFor(() =>
      within(document.body).getByRole("tooltip"),
    );
    expect(tooltip.textContent).toContain(
      "Return sends. Shift-Return adds a line.",
    );
    expect(tooltip.textContent).toContain(
      "You can message the Builder while the run is waiting for you.",
    );
    expect(tips.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("sits in the message box beside the textarea and the send button", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const form = container.querySelector("form.run-chat-input") as HTMLElement;
    expect(form.querySelector("textarea")).not.toBeNull();
    expect(
      within(form).getByRole("button", { name: "Message Tips" }),
    ).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Send" })).toBeTruthy();
  });
});
