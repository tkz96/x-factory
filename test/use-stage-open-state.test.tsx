// test/use-stage-open-state.test.tsx — useStageOpenState: the focus stage opens when the run reaches
// it or ends in it, a live run's open stages accumulate as it reaches them, a finished run's replayed
// events leave only the stage the run ended in open, and a stage the reader toggled themselves stays
// as they left it.

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

/**
 * The run ended in the given stage: it holds the end state, the stages before it are done, the rest
 * never ran. Items appear in the stages up to `withItems`; the default is the ended stage, and null
 * is a run whose events have not arrived yet (a failed or stopped run then stands in prepare).
 */
function endedGroups(
  stage: WorkflowStage,
  endState: "failed" | "stopped",
  withItems: WorkflowStage | null = stage,
): StageGroup[] {
  const at = STAGE_ORDER.indexOf(stage);
  const itemsUpTo = withItems === null ? -1 : STAGE_ORDER.indexOf(withItems);
  return STAGE_ORDER.map((s, index) =>
    group(
      s,
      s === stage ? endState : index < at ? "done" : "upcoming",
      index <= itemsUpTo ? [message(`m${index + 1}`, `Ran ${s}`)] : [],
    ),
  );
}

/**
 * A delivered run (pull request opened): every stage done, items in the stages up to `upto`, none
 * while `upto` is null (the run's events have not arrived yet).
 */
function deliveredGroups(upto: WorkflowStage | null): StageGroup[] {
  const at = upto === null ? -1 : STAGE_ORDER.indexOf(upto);
  return STAGE_ORDER.map((s, index) =>
    group(
      s,
      "done",
      index <= at ? [message(`m${index + 1}`, `Done in ${s}`)] : [],
    ),
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
    // Before the events arrive a failed run stands in Prepare, so that is what opens.
    const view = render(
      <Probe groups={endedGroups("prepare", "failed", null)} />,
    );
    expect([...state().openStages]).toEqual(["prepare"]);

    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "failed")} />);
    });
    expect([...state().openStages]).toEqual(["execute"]);
  });

  it("opens the stopped stage when its events arrive after the first render (a reload)", () => {
    const view = render(
      <Probe groups={endedGroups("prepare", "stopped", null)} />,
    );
    expect([...state().openStages]).toEqual(["prepare"]);

    act(() => {
      view.rerender(<Probe groups={endedGroups("execute", "stopped")} />);
    });
    expect([...state().openStages]).toEqual(["execute"]);
  });

  it("leaves only the stage a failed run ended in open as its events replay", () => {
    const view = render(
      <Probe groups={endedGroups("prepare", "failed", null)} />,
    );
    expect([...state().openStages]).toEqual(["prepare"]);

    // The events replay one message at a time, so the run passes through every stage.
    for (const stage of ["understand", "plan", "execute"] as const) {
      act(() => {
        view.rerender(<Probe groups={endedGroups(stage, "failed")} />);
      });
      expect([...state().openStages]).toEqual([stage]);
    }
  });

  it("leaves only the stage a stopped run ended in open as its events replay", () => {
    const view = render(
      <Probe groups={endedGroups("prepare", "stopped", null)} />,
    );
    expect([...state().openStages]).toEqual(["prepare"]);

    for (const stage of ["understand", "plan", "execute"] as const) {
      act(() => {
        view.rerender(<Probe groups={endedGroups(stage, "stopped")} />);
      });
      expect([...state().openStages]).toEqual([stage]);
    }
  });

  it("leaves only the last stage with items open as a delivered run's events replay", () => {
    // No events have arrived: every stage is done, none has items yet.
    const view = render(<Probe groups={deliveredGroups(null)} />);
    expect([...state().openStages]).toEqual([]);

    for (const stage of STAGE_ORDER) {
      act(() => {
        view.rerender(<Probe groups={deliveredGroups(stage)} />);
      });
      expect([...state().openStages]).toEqual([stage]);
    }
  });

  it("keeps a stage the reader opened by hand open as the focus moves on", () => {
    const view = render(<Probe groups={deliveredGroups("prepare")} />);
    expect([...state().openStages]).toEqual(["prepare"]);

    act(() => {
      view.rerender(<Probe groups={deliveredGroups("understand")} />);
    });
    expect([...state().openStages]).toEqual(["understand"]);

    // The reader opens Prepare again by hand while Understand is the focus.
    act(() => {
      state().toggleStage("prepare");
    });
    expect([...state().openStages].sort()).toEqual(["prepare", "understand"]);

    act(() => {
      view.rerender(<Probe groups={deliveredGroups("plan")} />);
    });
    expect([...state().openStages].sort()).toEqual(["plan", "prepare"]);
  });

  it("keeps a stage the reader closed closed while the focus stays on it", () => {
    const view = render(
      <Probe groups={endedGroups("prepare", "failed", null)} />,
    );
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

    // The focus moves on: the stage the reader closed stays closed.
    act(() => {
      view.rerender(<Probe groups={endedGroups("review", "failed")} />);
    });
    expect([...state().openStages]).toEqual(["review"]);
  });

  it("does not close stages the reader opened with Expand all", () => {
    const view = render(
      <Probe groups={endedGroups("prepare", "failed", null)} />,
    );
    act(() => {
      state().toggleAllStages();
    });
    expect(state().openStages.size).toBe(STAGE_ORDER.length);

    act(() => {
      view.rerender(<Probe groups={endedGroups("understand", "failed")} />);
    });
    expect([...state().openStages].sort()).toEqual([...STAGE_ORDER].sort());
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
