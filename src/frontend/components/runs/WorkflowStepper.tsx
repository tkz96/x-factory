// src/frontend/components/runs/WorkflowStepper.tsx — 6-Stage Workflow Stepper (XFM-50).

import "./WorkflowStepper.css";

import { useEffect, useMemo, useState } from "react";
import {
  STATUS_TO_STAGE,
  TERMINAL_RUN_STATUSES,
} from "../../../shared/run-status-policy.js";
import type { RunStatus, WorkflowStage } from "../../../shared/types.js";
import type { CanonicalWireEvent } from "../../hooks/useRunSSE.js";

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
    defaultEvidence: "Workspace & Worktree",
  },
  {
    stage: "understand",
    num: 2,
    label: "Understand",
    defaultEvidence: "Context Synthesis",
  },
  {
    stage: "plan",
    num: 3,
    label: "Plan",
    defaultEvidence: "Architectural Strategy",
  },
  {
    stage: "execute",
    num: 4,
    label: "Execute",
    defaultEvidence: "Implementation & Verification",
  },
  {
    stage: "review",
    num: 5,
    label: "Review",
    defaultEvidence: "Read-Only Session B",
  },
  {
    stage: "deliver",
    num: 6,
    label: "Deliver",
    defaultEvidence: "PR Checkpoint",
  },
];

export interface WorkflowStepperProps {
  status: RunStatus;
  startedAt?: string | null;
  events?: CanonicalWireEvent[];
  evidenceByStage?: Record<string, string>;
  stepperId?: string;
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
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  // Live timer for active stage elapsed duration
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || TERMINAL_RUN_STATUSES.has(status)) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, status]);

  // Extract Ralph iteration count during execution
  const ralphIteration = useMemo(() => {
    if (!events) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && e.type === "ralph_progress") {
        const payload = e.payload as { iteration?: number } | null | undefined;
        if (payload?.iteration) return payload.iteration;
      }
    }
    return null;
  }, [events]);

  const getStepClass = (idx: number) => {
    if (currentStage === null && idx === currentIdx) {
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
          if (isActive) {
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
