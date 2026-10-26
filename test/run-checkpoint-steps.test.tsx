// test/run-checkpoint-steps.test.tsx — What the run chat does when a checkpoint button is pressed: the
// line it shows, the rework the reader writes first, and the abandon that asks before it acts.
// The actions reach the page as the chat's onAction calls; the page's own requests are tested apart.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-09-20T12:34:56.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "",
    branch: "feat/login",
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

/** Types into the message box the way the browser does, then sends it. */
function typeAndSend(container: HTMLElement, text: string) {
  const area = container.querySelector(
    "form.run-chat-input textarea",
  ) as HTMLTextAreaElement;
  act(() => {
    area.focus();
    fireEvent.change(area, { target: { value: text } });
    fireEvent.keyUp(area);
  });
  act(() => {
    fireEvent.submit(area.closest("form") as HTMLFormElement);
  });
}

describe("a checkpoint button says what was just pressed", () => {
  it("Request Changes on a plan goes back to planning and says so", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_plan_approval")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Request Changes" }),
    );
    expect(actions).toEqual(["restart"]);
    expect(container.textContent).toContain("Changes requested");
  });

  it("Create Pull Request on a ready run says the pull request is opening", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("ready_for_pr")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Create Pull Request" }),
    );
    expect(actions).toEqual(["deliver"]);
    expect(container.textContent).toContain("Opening a pull request");
  });

  it("Resume Run on a run that needs recovery says the run is resuming", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("recovery_required")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Resume Run" }),
    );
    expect(actions).toEqual(["resume"]);
    expect(container.textContent).toContain("Resuming the run");
  });

  it("Retry Review says the review is retrying", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("review_retry_required")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Retry Review" }),
    );
    expect(actions).toEqual(["retry-review"]);
    expect(container.textContent).toContain("Retrying the review");
  });

  it("Approve Changes on a review says the pull request is opening", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_review")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Approve Changes" }),
    );
    expect(actions).toEqual(["approve"]);
    expect(container.textContent).toContain(
      "Changes approved — opening a pull request",
    );
  });

  it("starts a new run without a line of its own", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("failed")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Start New Run" }),
    );
    expect(actions).toEqual(["start-new-run"]);
    expect(container.textContent).not.toContain("Abandoned");
    expect(container.textContent).not.toContain("Changes requested");
  });
});

describe("Abandon Run confirmed in the alert says the run is abandoned", () => {
  it("shows Abandoned once the reader confirms", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("recovery_required")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Abandon Run" }),
    );
    expect(container.textContent).not.toContain("Abandoned");
    const alert = within(document.body).getByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Abandon Run" }));
    expect(actions).toEqual(["abandon"]);
    expect(container.textContent).toContain("Abandoned");
  });
});

describe("Request Changes on a review asks for the changes before it acts", () => {
  it("shows the rework prompt, moves focus to the message box, and sends the notes only on Confirm Rework", async () => {
    const actions: Array<[string, string | undefined]> = [];
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_review")}
        events={[]}
        onAction={(action, notes) => actions.push([action, notes])}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Request Changes" }),
    );
    // Nothing is sent yet: the chat asks for the changes first.
    expect(actions).toEqual([]);
    expect(container.textContent).toContain(
      "Describe the changes needed. Your next message goes back to planning.",
    );
    const area = container.querySelector(
      "form.run-chat-input textarea",
    ) as HTMLTextAreaElement;
    expect(area.getAttribute("placeholder")).toBe(
      "Describe the changes needed before replanning…",
    );
    // The focus moves to the message box once the prompt is shown.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(document.activeElement).toBe(area);

    typeAndSend(container, "Keep the parser, drop the cache");
    expect(actions).toEqual([]);
    expect(container.textContent).toContain("Keep the parser, drop the cache");

    fireEvent.click(
      within(container).getByRole("button", { name: "Confirm Rework" }),
    );
    expect(actions).toEqual([["requeue", "Keep the parser, drop the cache"]]);
  });
});

describe("a new status starts the chat's pending steps over", () => {
  it("clears the line and the rework prompt the old status left behind", () => {
    const onAction = () => {};
    const view = render(
      <RunChat
        run={makeRun("awaiting_review")}
        events={[]}
        onAction={onAction}
      />,
    );
    const { container, rerender } = view;
    fireEvent.click(
      within(container).getByRole("button", { name: "Approve Changes" }),
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Request Changes" }),
    );
    expect(
      container
        .querySelector("form.run-chat-input textarea")
        ?.getAttribute("placeholder"),
    ).toBe("Describe the changes needed before replanning…");

    // The run moves on to writing code: the earlier steps belong to the old status.
    rerender(
      <RunChat run={makeRun("executing")} events={[]} onAction={onAction} />,
    );
    expect(container.textContent).not.toContain(
      "Changes approved — opening a pull request",
    );
    // The notice that stays in the log is history; the composer no longer waits for rework notes.
    expect(
      container
        .querySelector("form.run-chat-input textarea")
        ?.getAttribute("placeholder"),
    ).toBe("Message the Builder…");
  });
});
