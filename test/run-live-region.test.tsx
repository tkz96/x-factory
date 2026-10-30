// test/run-live-region.test.tsx — The run timeline's live-region scope (#319, US19):
// the scrolling log is not one live region announcing every line, a small visually
// hidden status node announces stage changes, results, errors and "needs you", and
// the decision card sits outside every live region.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RunChatLog } from "../src/frontend/components/runs/RunChatLog.js";
import type { ChatItem } from "../src/frontend/lib/run-chat-items.js";
import type { StageGroup, StageState } from "../src/frontend/lib/run-stages.js";
import { STAGE_LABELS } from "../src/frontend/lib/workflow-stages.js";
import type { WorkflowStage } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const NOW = Date.parse("2026-10-20T10:05:00.000Z");

/** The roles that announce their content changes without an explicit aria-live. */
const LIVE_ROLES = new Set(["alert", "log", "marquee", "status", "timer"]);

function message(id: string, text: string): ChatItem {
  return { id, at: "2026-10-20T10:00:00.000Z", kind: "message", role: "user", text };
}

function group(
  stage: WorkflowStage,
  state: StageState,
  items: ChatItem[] = [],
): StageGroup {
  return {
    stage,
    label: STAGE_LABELS[stage],
    state,
    items,
    startedAt: items[0] ? items[0].at : null,
    endedAt: null,
    tookMs: null,
  };
}

/** Prepare and Understand are done, Plan is current, the rest are upcoming. */
function sampleGroups(): StageGroup[] {
  return [
    group("prepare", "done", [message("m1", "Read the ticket")]),
    group("understand", "done", [message("m2", "Understood the change")]),
    group("plan", "current", [message("m3", "Drafting the plan")]),
    group("execute", "upcoming"),
    group("review", "upcoming"),
    group("deliver", "upcoming"),
  ];
}

function renderLog(overrides: Partial<Parameters<typeof RunChatLog>[0]> = {}) {
  const props = {
    items: [] as ChatItem[],
    groups: sampleGroups(),
    openStages: new Set<WorkflowStage>(["plan"]),
    onToggleStage: () => {},
    now: NOW,
    retryFor: () => undefined,
    waiting: false,
    failure: null,
    resolved: null,
    sending: false,
    ...overrides,
  };
  return { ...render(<RunChatLog {...props} />), props };
}

describe("the run timeline announces through one status node (#319, US19)", () => {
  it("the scrolling log is not itself a live region", () => {
    const { container } = renderLog();
    const messages = container.querySelector(".run-chat-messages");
    expect(messages).not.toBeNull();
    expect(messages?.getAttribute("aria-live")).toBeNull();
    expect(messages?.getAttribute("aria-relevant")).toBeNull();
    expect(LIVE_ROLES.has(messages?.getAttribute("role") ?? "")).toBe(false);
  });

  it("holds stage changes, results, errors and needs you in one hidden status node", () => {
    const { container, props, rerender } = renderLog();
    const status = container.querySelector('.sr-only[role="status"]');
    expect(status).not.toBeNull();
    const text = () => status?.textContent ?? "";

    // The current stage, announced when it becomes the current stage.
    expect(text()).toContain("Plan");

    // A stage change moves the announcement along.
    const moved = sampleGroups();
    moved[2] = group("plan", "done", [message("m3", "Planned")]);
    moved[3] = group("execute", "current", [message("m4", "Coding")]);
    rerender(<RunChatLog {...props} groups={moved} />);
    expect(text()).toContain(STAGE_LABELS.execute);

    // A result: the latest verification/review verdict.
    const result: ChatItem = {
      id: "r1",
      at: "2026-10-20T10:04:00.000Z",
      kind: "result",
      title: "Verification",
      passed: true,
      summary: "9 of 9 passed",
    };
    rerender(<RunChatLog {...props} items={[result]} />);
    expect(text()).toContain("Verification passed");

    // An error from the timeline.
    const error: ChatItem = {
      id: "e1",
      at: "2026-10-20T10:04:30.000Z",
      kind: "error",
      text: "The model quota ran out",
    };
    rerender(<RunChatLog {...props} items={[error]} />);
    expect(text()).toContain("The model quota ran out");

    // A failed send.
    rerender(
      <RunChatLog
        {...props}
        failure={{ message: "Message could not be sent" }}
      />,
    );
    expect(text()).toContain("Message could not be sent");

    // "Needs you" when the run waits on the reader.
    rerender(<RunChatLog {...props} waiting />);
    expect(text()).toContain("Needs you");
  });

  it("keeps the decision card outside every live region", () => {
    const { container } = renderLog({
      decision: <div data-testid="decision">Start when ready</div>,
    });
    let node: HTMLElement | null = container.querySelector(
      '[data-testid="decision"]',
    );
    expect(node).not.toBeNull();
    while (node) {
      expect(node.getAttribute("aria-live")).toBeNull();
      expect(LIVE_ROLES.has(node.getAttribute("role") ?? "")).toBe(false);
      node = node.parentElement;
    }
  });
});
