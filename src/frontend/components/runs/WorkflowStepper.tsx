// src/frontend/components/runs/WorkflowStepper.tsx — 6-Stage Workflow Stepper (XFM-50).

import "./WorkflowStepper.css";

import { useEffect, useMemo, useState } from "react";
import {
  AWAITING_HUMAN_RUN_STATUSES,
  STATUS_TO_STAGE,
  TERMINAL_RUN_STATUSES,
} from "../../../shared/run-status-policy.js";
import type {
  RunEvent,
  RunStatus,
  WorkflowStage,
} from "../../../shared/types.js";

const STAGE_ORDER: WorkflowStage[] = [
  "prepare",
  "understand",
  "plan",
  "execute",
  "review",
  "deliver",
];

const STAGE_CONFIG: Array<{
  stage: WorkflowStage;
  num: number;
  label: string;
  defaultEvidence: string;
}> = [
  {
    stage: "prepare",
    num: 1,
    label: "Prepare",
    defaultEvidence: "Setting up the branch",
  },
  {
    stage: "understand",
    num: 2,
    label: "Understand",
    defaultEvidence: "Reading the ticket",
  },
  {
    stage: "plan",
    num: 3,
    label: "Plan",
    defaultEvidence: "Drafting the plan",
  },
  {
    stage: "execute",
    num: 4,
    label: "Code",
    defaultEvidence: "Writing the changes",
  },
  {
    stage: "review",
    num: 5,
    label: "Review",
    defaultEvidence: "Checking the changes",
  },
  {
    stage: "deliver",
    num: 6,
    label: "Deliver",
    defaultEvidence: "Pull request",
  },
];

export interface WorkflowStepperProps {
  status: RunStatus;
  startedAt?: string | null;
  events?: RunEvent[];
  evidenceByStage?: Record<string, string>;
  stepperId?: string;
}

/**
 * The stage a run that left the stages behind (failed) was last in: the stage of
 * the latest status event that names one.
 */
function lastStageIn(
  events: readonly RunEvent[] | undefined,
): WorkflowStage | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== "status") continue;
    const status = (event.payload as { status?: RunStatus }).status;
    const stage = status ? STATUS_TO_STAGE[status] : null;
    if (stage) return stage;
  }
  return null;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

export function WorkflowStepper({
  status,
  startedAt,
  events,
  evidenceByStage = {},
  stepperId = "workflow-stepper",
}: WorkflowStepperProps) {
  const currentStage = STATUS_TO_STAGE[status];
  // A failed run has no stage of its own; the strip marks the one it stopped at.
  const failedStage = status === "failed" ? lastStageIn(events) : null;
  const shownStage = currentStage ?? failedStage;
  const currentIdx = shownStage ? STAGE_ORDER.indexOf(shownStage) : -1;
  // At a checkpoint the run is not working: it waits for the reader.
  const isWaiting = AWAITING_HUMAN_RUN_STATUSES.has(status);

  // Live timer for active stage elapsed duration; nothing runs while it waits.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || TERMINAL_RUN_STATUSES.has(status) || isWaiting) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, status, isWaiting]);

  // Extract Ralph iteration count during execution
  const ralphIteration = useMemo(() => {
    if (!events) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === "ralph_progress" && e.payload.iteration) {
        return e.payload.iteration;
      }
    }
    return null;
  }, [events]);

  const getStepClass = (idx: number) => {
    if (failedStage !== null && idx === currentIdx) {
      return "failed";
    }
    if (status === "pr_created" || (currentIdx !== -1 && idx < currentIdx)) {
      return "completed";
    }
    if (currentIdx !== -1 && idx === currentIdx) {
      return "active";
    }
    return "pending";
  };

  const progressClass =
    currentIdx >= 0 ? `progress-step-${currentIdx}` : "progress-step-0";

  return (
    <nav
      className="workflow-stepper"
      id={stepperId}
      aria-label="Workflow progress"
    >
      <div className="stepper-progress-track">
        <div className="stepper-track-bg" />
        <div className={`stepper-track-fill ${progressClass}`} />
      </div>

      <div className="stepper-steps-row">
        {STAGE_CONFIG.map(({ stage, num, label, defaultEvidence }, idx) => {
          const stepCls = getStepClass(idx);
          const isCompleted = stepCls === "completed";
          const isActive = stepCls === "active";

          let evidenceText = evidenceByStage[stage] || defaultEvidence;

          // Stage-specific enhancements
          if (stepCls === "failed") {
            evidenceText = "Failed";
          } else if (isActive && isWaiting) {
            evidenceText = "Waiting for you";
          } else if (isActive) {
            const elapsedMs = startedAt
              ? Math.max(0, now - new Date(startedAt).getTime())
              : null;
            const elapsedStr =
              elapsedMs !== null ? formatDuration(elapsedMs) : "";

            if (stage === "execute" && ralphIteration) {
              evidenceText = `Iteration ${ralphIteration}${elapsedStr ? ` · ${elapsedStr}` : ""}`;
            } else if (elapsedStr) {
              evidenceText = `${defaultEvidence} · ${elapsedStr}`;
            }
          }

          return (
            <div
              key={stage}
              className={`step ${stepCls}`}
              data-stage={stage}
              title={`${num}. ${label}: ${evidenceText}`}
            >
              <div className="step-dot">
                {isCompleted ? (
                  <svg className="icon icon-xs" aria-hidden="true">
                    <use href="/assets/icons/sprite.svg#icon-check" />
                  </svg>
                ) : (
                  <span>{num}</span>
                )}
              </div>
              <div className="step-info">
                <span className="step-label">{label}</span>
                <span className="step-evidence" id={`evidence-${stage}`}>
                  {evidenceText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
