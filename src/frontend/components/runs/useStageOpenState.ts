// src/frontend/components/runs/useStageOpenState.ts — Which of the run chat's six stages are open: the
// default (the focus stage), the current stage opening as the run reaches it, and the reader's own
// toggles kept. Expand all / Collapse all toggle every stage at once.

import { useEffect, useRef, useState } from "react";
import type { WorkflowStage } from "../../../shared/types.js";
import type { StageGroup } from "../../lib/run-stages.js";
import { STAGE_ORDER } from "../../lib/workflow-stages.js";
import { defaultOpenStages } from "./RunStageTimeline.js";

interface StageOpenState {
  openStages: ReadonlySet<WorkflowStage>;
  allOpen: boolean;
  toggleStage: (stage: WorkflowStage) => void;
  toggleAllStages: () => void;
}

export function useStageOpenState(
  groups: readonly StageGroup[],
): StageOpenState {
  const [openStages, setOpenStages] = useState(() => defaultOpenStages(groups));
  const currentStage =
    groups.find((group) => group.state === "current")?.stage ?? null;
  const shownStageRef = useRef(currentStage);

  // The current stage opens when the run reaches it; a stage the reader closed stays as they left it
  // until the run moves on.
  useEffect(() => {
    if (currentStage === null || currentStage === shownStageRef.current) return;
    shownStageRef.current = currentStage;
    setOpenStages((prev) => new Set(prev).add(currentStage));
  }, [currentStage]);

  const allOpen = groups.every((group) => openStages.has(group.stage));

  const toggleStage = (stage: WorkflowStage) =>
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const toggleAllStages = () =>
    setOpenStages(new Set(allOpen ? [] : STAGE_ORDER));

  return { openStages, allOpen, toggleStage, toggleAllStages };
}
