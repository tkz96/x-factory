// test/run-stage-timeline.test.tsx — The run chat's stage timeline: six stages in order, collapsed stages
// showing only their header, the controlled open state, the decision inside the current stage, the
// default open stage (spec "Left panel: stage timeline").

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  defaultDecisionStage,
  RunStageTimeline,
  type RunStageTimelineProps,
} from "../src/frontend/components/runs/RunStageTimeline.js";
import type { ChatItem } from "../src/frontend/lib/run-chat-items.js";
import {
  type Attempt,
  defaultOpenStages,
  type StageGroup,
  type StageState,
} from "../src/frontend/lib/run-stages.js";
import {
  STAGE_LABELS,
  STAGE_ORDER,
} from "../src/frontend/lib/workflow-stages.js";
import type { WorkflowStage } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const NOW = Date.parse("2026-10-20T10:05:00.000Z");

function message(
  id: string,
  text: string,
  role: "user" | "agent" = "user",
): ChatItem {
  return { id, at: "2026-10-20T10:00:00.000Z", kind: "message", role, text };
}

function group(
  stage: WorkflowStage,
  state: StageState,
  items: ChatItem[] = [],
  tookMs: number | null = null,
): StageGroup {
  return {
    stage,
    label: STAGE_LABELS[stage],
    state,
    items,
    startedAt: items[0] ? items[0].at : null,
    endedAt: tookMs === null ? null : "2026-10-20T10:01:00.000Z",
    tookMs,
  };
}

/** Prepare and Understand are done, Plan is current, the rest are upcoming. */
function sampleGroups(): StageGroup[] {
  return [
    group("prepare", "done", [message("m1", "Read the ticket")], 12_000),
    group(
      "understand",
      "done",
      [message("m2", "Understood the change")],
      64_000,
    ),
    group("plan", "current", [message("m3", "Drafting the plan", "agent")]),
    group("execute", "upcoming"),
    group("review", "upcoming"),
    group("deliver", "upcoming"),
  ];
}

function renderTimeline(overrides: Partial<RunStageTimelineProps> = {}) {
  const props: RunStageTimelineProps = {
    groups: sampleGroups(),
    open: new Set<WorkflowStage>(["plan"]),
    onToggle: () => {},
    now: NOW,
    ...overrides,
  };
  const result = render(<RunStageTimeline {...props} />);
  return { ...result, props };
}

function stageItem(container: HTMLElement, stage: WorkflowStage): HTMLElement {
  const label = STAGE_LABELS[stage];
  const found = Array.from(
    container.querySelectorAll<HTMLElement>("li.run-stage"),
  ).find((li) => li.querySelector(".run-stage-label")?.textContent === label);
  if (!found) throw new Error(`no stage ${stage}`);
  return found;
}

function headerOf(
  container: HTMLElement,
  stage: WorkflowStage,
): HTMLButtonElement {
  return within(stageItem(container, stage)).getByRole(
    "button",
  ) as HTMLButtonElement;
}

describe("RunStageTimeline", () => {
  it("renders the six stages in order with their labels", () => {
    const { container } = renderTimeline();
    const labels = Array.from(
      container.querySelectorAll(".run-stage-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      "Prepare",
      "Understand",
      "Plan",
      "Code",
      "Review",
      "Deliver",
    ]);
    expect(container.querySelectorAll("li.run-stage")).toHaveLength(
      STAGE_ORDER.length,
    );
  });

  it("shows only the label and Took for a collapsed done stage; its body is closed and inert", () => {
    const { container } = renderTimeline();
    const prepare = stageItem(container, "prepare");
    const header = headerOf(container, "prepare");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toBe("PrepareTook 12s");

    const body = prepare.querySelector<HTMLElement>(".run-stage-body");
    expect(body?.getAttribute("data-open")).toBe("false");
    expect(body?.hasAttribute("inert")).toBe(true);
    // Plain content under the heading: no region landmark (#319, US20).
    expect(body?.tagName).toBe("DIV");
    expect(body?.hasAttribute("aria-labelledby")).toBe(false);
    expect(body?.id).toBe(header.getAttribute("aria-controls") ?? "");
  });

  it("calls onToggle with the stage when its header is clicked", () => {
    const onToggle = mock((_stage: WorkflowStage) => {});
    const { container } = renderTimeline({ onToggle });
    fireEvent.click(headerOf(container, "understand"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("understand");
  });

  it("reflects the open set in aria-expanded and the body's data-open", () => {
    const { container } = renderTimeline({
      open: new Set<WorkflowStage>(["plan", "prepare"]),
    });
    expect(headerOf(container, "plan").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(headerOf(container, "prepare").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      headerOf(container, "understand").getAttribute("aria-expanded"),
    ).toBe("false");
    const planBody = stageItem(container, "plan").querySelector(
      ".run-stage-body",
    );
    expect(planBody?.getAttribute("data-open")).toBe("true");
    expect(planBody?.hasAttribute("inert")).toBe(false);
  });

  it("shows the stage's items inside its body, and Nothing yet. for an empty stage", () => {
    const { container } = renderTimeline({
      open: new Set<WorkflowStage>(["plan", "execute"]),
    });
    const plan = stageItem(container, "plan");
    expect(within(plan).getByText("Drafting the plan")).toBeTruthy();
    expect(plan.querySelector(".run-stage-empty")).toBeNull();
    const execute = stageItem(container, "execute");
    expect(within(execute).getByText("Nothing yet.")).toBeTruthy();
    expect(headerOf(container, "execute").textContent).toBe("Code");
  });

  it("renders the decision only inside the current stage", () => {
    const { container } = renderTimeline({
      decision: <p>Decision card</p>,
    });
    const matches = container.querySelectorAll("li.run-stage");
    const holders = Array.from(matches).filter((li) =>
      li.textContent?.includes("Decision card"),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]?.getAttribute("data-state")).toBe("current");
  });

  it("renders the decision in the failed stage of a run that has no current stage", () => {
    const groups: StageGroup[] = [
      group("prepare", "done", [message("m1", "Read the ticket")], 12_000),
      group("understand", "done", [message("m2", "Understood")], 64_000),
      group("plan", "failed", [message("m3", "Drafting the plan", "agent")]),
      group("execute", "upcoming"),
      group("review", "upcoming"),
      group("deliver", "upcoming"),
    ];
    const { container } = renderTimeline({
      groups,
      decision: <p>Decision card</p>,
      open: defaultOpenStages(groups),
    });
    const holder = Array.from(container.querySelectorAll("li.run-stage")).find(
      (li) => li.textContent?.includes("Decision card"),
    );
    expect(holder?.getAttribute("data-state")).toBe("failed");
  });

  it("keeps the decision visible when its stage is collapsed, outside the stage body", () => {
    const { container, getByText } = renderTimeline({
      open: new Set<WorkflowStage>(),
      decision: <p>Decision card</p>,
    });
    const decision = getByText("Decision card");
    expect(stageItem(container, "plan").contains(decision)).toBe(true);
    expect(decision.closest(".run-stage-body")).toBeNull();
    expect(decision.closest("[inert]")).toBeNull();
  });

  it("does not repeat Needs you as a Waiting for you pill on the stage", () => {
    const { queryByText } = renderTimeline({ decision: <p>Decision card</p> });
    expect(queryByText("Waiting for you")).toBeNull();
  });

  it("shows Failed for a failed stage and no Took while it is current", () => {
    const groups = sampleGroups();
    groups[2] = group("plan", "failed", [message("m3", "Plan failed")], 5_000);
    const { container } = renderTimeline({ groups });
    expect(headerOf(container, "plan").textContent).toBe("PlanTook 5sFailed");
    expect(headerOf(container, "execute").textContent).toBe("Code");
  });
});

describe("the stage header path for keyboard readers (#319, US20)", () => {
  it("sits every stage header button inside an h3", () => {
    const { container } = renderTimeline();
    const headers = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.run-stage-header"),
    );
    expect(headers.length).toBe(STAGE_ORDER.length);
    for (const button of headers) {
      expect(button.closest("h3")).not.toBeNull();
    }
  });

  it("gives the stage bodies no region role", () => {
    const { container } = renderTimeline();
    // A <section> with aria-labelledby is announced as a region; the body is
    // plain content under the heading now, not its own landmark.
    const body = container.querySelector(".run-stage-body");
    expect(body).not.toBeNull();
    expect(body?.tagName).toBe("DIV");
    expect(body?.hasAttribute("aria-labelledby")).toBe(false);
  });
});

describe("defaultDecisionStage", () => {
  it("is the current stage while the run works or waits", () => {
    expect(defaultDecisionStage(sampleGroups())).toBe("plan");
  });

  it("is the failed stage a failed run stopped at", () => {
    const groups = sampleGroups().map((g) =>
      g.stage === "plan" ? { ...g, state: "failed" as StageState } : g,
    );
    expect(defaultDecisionStage(groups)).toBe("plan");
  });

  it("is the last stage with items once every stage is done (pull request opened)", () => {
    const groups = STAGE_ORDER.map((stage) =>
      group(stage, "done", stage === "deliver" ? [message("d", "Opened")] : []),
    );
    expect(defaultDecisionStage(groups)).toBe("deliver");
  });

  it("falls back to the last stage when no stage has items", () => {
    const groups = STAGE_ORDER.map((stage) => group(stage, "upcoming"));
    expect(defaultDecisionStage(groups)).toBe("deliver");
  });
});

describe("defaultOpenStages", () => {
  it("opens the current stage", () => {
    expect([...defaultOpenStages(sampleGroups())]).toEqual(["plan"]);
  });

  it("opens the failed stage over the last stage with items", () => {
    const groups = sampleGroups();
    groups[2] = group("plan", "failed", [message("m3", "Plan failed")]);
    expect([...defaultOpenStages(groups)]).toEqual(["plan"]);
  });

  it("opens the last stage that has items when no stage is current", () => {
    const groups = sampleGroups().map((g) =>
      g.stage === "plan"
        ? group("plan", "done", [message("m3", "Planned")], 3_000)
        : g,
    );
    groups[3] = group("execute", "done", [], null);
    groups[4] = group("review", "done", [message("m4", "Reviewed")], 2_000);
    groups[5] = group("deliver", "done", []);
    expect([...defaultOpenStages(groups)]).toEqual(["review"]);
  });

  it("opens nothing when no stage has items", () => {
    const groups = STAGE_ORDER.map((stage) => group(stage, "upcoming"));
    expect(defaultOpenStages(groups).size).toBe(0);
  });
});

describe("RunStageTimeline: attempts", () => {
  function twoAttempts(): Attempt[] {
    return [
      {
        number: 1,
        reworkedFrom: null,
        label: "Attempt 1",
        groups: [
          group("execute", "done", [message("m1", "First try coding")], 60_000),
          group("review", "done", [message("m2", "First review")], 30_000),
        ],
      },
      {
        number: 2,
        reworkedFrom: "review",
        label: "Attempt 2 · Reworked from Review",
        groups: [
          group("execute", "done", [message("m3", "Second try coding")]),
          group("review", "current", [message("m4", "Second review")]),
          group("deliver", "upcoming"),
        ],
      },
    ];
  }

  it("shows no attempt header for a run with one attempt", () => {
    const { container } = renderTimeline({
      attempts: [
        {
          number: 1,
          reworkedFrom: null,
          label: "Attempt 1",
          groups: sampleGroups(),
        },
      ],
    });
    expect(container.querySelector(".run-attempt")).toBeNull();
  });

  it("folds the earlier attempt and opens the latest", () => {
    const attempts = twoAttempts();
    const { getByRole, getByText } = renderTimeline({
      attempts,
      groups: attempts[1]?.groups ?? [],
      open: new Set<WorkflowStage>(["review"]),
    });
    const first = getByRole("button", { name: /Attempt 1/ });
    const second = getByRole("button", {
      name: /Attempt 2 · Reworked from Review/,
    });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(getByText("Second review")).toBeTruthy();
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders nothing for a folded earlier attempt until it is opened", () => {
    const attempts = twoAttempts();
    const { getByRole, container } = renderTimeline({
      attempts,
      groups: attempts[1]?.groups ?? [],
      open: new Set<WorkflowStage>(["review"]),
    });
    const earlier = container.querySelectorAll(".run-attempt-body")[0];
    expect(earlier?.children.length).toBe(0);
    fireEvent.click(getByRole("button", { name: /Attempt 1/ }));
    expect(earlier?.children.length).toBeGreaterThan(0);
  });

  it("puts the decision in the latest attempt only", () => {
    const attempts = twoAttempts();
    const { getAllByText } = renderTimeline({
      attempts,
      groups: attempts[1]?.groups ?? [],
      decision: <p>Decision card</p>,
    });
    expect(getAllByText("Decision card")).toHaveLength(1);
  });
});
