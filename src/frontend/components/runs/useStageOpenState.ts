// src/frontend/components/runs/useStageOpenState.ts — Which of the run chat's six stages are open.
// The focus stage opens at first. A live run moving from one current stage to the next opens each
// new current stage and leaves the earlier ones open. Every other focus move — a failed, stopped or
// finished run's focus, or a move whose previous focus was not current — closes the stage this hook
// opened last and opens the new focus, so a replayed run ends with only the stage it ended in open.
// A stage the reader toggled themselves (or with Expand all / Collapse all) is never closed by that
// rule. Expand all / Collapse all toggle every stage at once.

import { useEffect, useReducer } from "react";
import type { WorkflowStage } from "../../../shared/types.js";
import type { StageGroup, StageState } from "../../lib/run-stages.js";
import { STAGE_ORDER } from "../../lib/workflow-stages.js";
import { defaultOpenStages, focusStage } from "./RunStageTimeline.js";

interface StageOpenState {
  openStages: ReadonlySet<WorkflowStage>;
  allOpen: boolean;
  toggleStage: (stage: WorkflowStage) => void;
  toggleAllStages: () => void;
}

/** Where the run is, as far as opening stages is concerned. */
interface Focus {
  stage: WorkflowStage;
  state: StageState;
}

interface State {
  open: ReadonlySet<WorkflowStage>;
  /** The focus the rule applied last. */
  focus: Focus | null;
  /** The stage the rule opened last, and whether the reader has touched it since. */
  autoOpened: { stage: WorkflowStage; readerTouched: boolean } | null;
}

type Action =
  | { type: "focus"; focus: Focus | null }
  | { type: "toggle"; stage: WorkflowStage }
  | { type: "toggleAll"; allOpen: boolean };

/** The focus stage of a group list and its state, or null when no stage is in focus. */
function focusOf(groups: readonly StageGroup[]): Focus | null {
  const stage = focusStage(groups);
  const found = groups.find((group) => group.stage === stage);
  return found ? { stage: found.stage, state: found.state } : null;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "toggle": {
      const open = new Set(state.open);
      if (open.has(action.stage)) open.delete(action.stage);
      else open.add(action.stage);
      return {
        ...state,
        open,
        autoOpened:
          state.autoOpened?.stage === action.stage
            ? { ...state.autoOpened, readerTouched: true }
            : state.autoOpened,
      };
    }
    case "toggleAll":
      return {
        ...state,
        open: new Set(action.allOpen ? [] : STAGE_ORDER),
        autoOpened: state.autoOpened
          ? { ...state.autoOpened, readerTouched: true }
          : null,
      };
    case "focus": {
      const { focus } = action;
      if (focus?.stage === state.focus?.stage) {
        // The same stage: only its state can have changed, and the reader's open set stands.
        return focus?.state === state.focus?.state
          ? state
          : { ...state, focus };
      }
      // Live progression accumulates; every other move replaces the stage the rule opened last.
      const progressing =
        state.focus?.state === "current" && focus?.state === "current";
      const open = new Set(state.open);
      if (!progressing && state.autoOpened && !state.autoOpened.readerTouched) {
        open.delete(state.autoOpened.stage);
      }
      if (focus === null) return { open, focus: null, autoOpened: null };
      const alreadyOpen = open.has(focus.stage);
      open.add(focus.stage);
      // A stage that was already open is the reader's, not the rule's, so the rule leaves it alone.
      return {
        open,
        focus,
        autoOpened: { stage: focus.stage, readerTouched: alreadyOpen },
      };
    }
  }
}

function initialState(groups: readonly StageGroup[]): State {
  const focus = focusOf(groups);
  return {
    open: defaultOpenStages(groups),
    focus,
    autoOpened:
      focus === null ? null : { stage: focus.stage, readerTouched: false },
  };
}

export function useStageOpenState(
  groups: readonly StageGroup[],
): StageOpenState {
  const [state, dispatch] = useReducer(reducer, groups, initialState);
  const focus = focusOf(groups);
  const focusedStage = focus?.stage ?? null;
  const focusedState = focus?.state ?? null;

  // The focus stage opens when the run reaches it or ends in it — a reload, whose events arrive
  // after the first render, is one such arrival.
  useEffect(() => {
    dispatch({
      type: "focus",
      focus:
        focusedStage === null || focusedState === null
          ? null
          : { stage: focusedStage, state: focusedState },
    });
  }, [focusedStage, focusedState]);

  const allOpen = groups.every((group) => state.open.has(group.stage));

  return {
    openStages: state.open,
    allOpen,
    toggleStage: (stage) => dispatch({ type: "toggle", stage }),
    toggleAllStages: () => dispatch({ type: "toggleAll", allOpen }),
  };
}
