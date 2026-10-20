// test/use-stage-open-state.test.tsx — useStageOpenState: the focus stage opens when the run reaches
// it or ends in it (a reload, whose events arrive after the first render, is one such arrival), and a
// stage the reader closed stays closed until the focus moves on.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useStageOpenState } from "../src/frontend/components/runs/useStageOpenState.js";
import type { ChatItem } from "../src/frontend/lib/run-chat-items.js";
import type { StageGroup, StageState } from "../src/frontend/lib/run-stages.js";
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

function message(id: string, text: string): ChatItem {
  return {
    id,
    at: "2026-10-20T10:00:00.000Z",
    kind: "message",
    role: "user",
    text,
  };
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
function planCurrentGroups(): StageGroup[] {
  return [
    group("prepare", "done", [message("m1", "Read the ticket")]),
    group("understand", "done", [message("m2", "Understood the change")]),
    group("plan", "current", [message("m3", "Drafting the plan")]),
    group("execute", "upcoming"),
    group("review", "upcoming"),
    group("deliver", "upcoming"),
  ];
}

/** The run ended in the given stage: it holds the end state, the stages before it are done, the rest
 * never ran. */
function endedGroups(
  stage: WorkflowStage,
  endState: "failed" | "stopped",
): StageGroup[] {
  const at = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER.map((s, index) =>
    s === stage
      ? group(s, endState, [message("m3", "The run ended here")])
      : group(s, index < at ? "done" : "upcoming"),
  );
}

/** The hook's latest state, captured on each render of the probe. */
let latest: ReturnType<typeof useStageOpenState> | null = null;

function Probe({ groups }: { groups: readonly StageGroup[] }) {
  latest = useStageOpenState(groups);
  return null;
}

/** The hook's state after its last render. */
function state(): ReturnType<typeof useStageOpenState> {
  if (!latest) throw new Error("the probe has not rendered");
  return latest;
}

describe("useStageOpenState", () => {
  it("opens the failed stage when its events arrive after the first render (a reload)", () => {
    const view = render(<Probe groups={[]} />);
    expect([...state().openStages]).toEqual([]);

    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "failed")} />);
    });
    expect([...state().openStages]).toEqual(["execute"]);
  });

  it("opens the stopped stage when its events arrive after the first render (a reload)", () => {
    const view = render(<Probe groups={[]} />);

    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "stopped")} />);
    });
    expect([...state().openStages]).toEqual(["execute"]);
  });

  it("keeps a stage the reader closed closed while the focus stays on it", () => {
    const view = render(<Probe groups={[]} />);
    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "failed")} />);
    });
    expect([...state().openStages]).toEqual(["execute"]);

    act(() => {
      state().toggleStage("execute");
    });
    expect([...state().openStages]).toEqual([]);

    // Later renders with the same groups do not reopen it.
    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "failed")} />);
    });
    expect([...state().openStages]).toEqual([]);
  });

  it("still opens the current stage as the run reaches it", () => {
    const view = render(<Probe groups={planCurrentGroups()} />);
    expect([...state().openStages]).toEqual(["plan"]);

    // The run moves on to Code.
    const moved = planCurrentGroups().map((g) =>
      g.stage === "plan" ? group("plan", "done", g.items) : g,
    );
    moved[STAGE_ORDER.indexOf("execute")] = group("execute", "current", [
      message("m4", "Writing code"),
    ]);
    act(() => {
      view.rerender(<Probe groups={moved} />);
    });
    expect([...state().openStages]).toEqual(["plan", "execute"]);
  });
});
