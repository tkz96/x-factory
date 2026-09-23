// src/frontend/components/runs/WorkflowStepper.tsx — 6-Stage Workflow Stepper (XFM-50).

import "./WorkflowStepper.css";

import type { RunStatus, WorkflowStage } from "../../../shared/types.js";

const STAGE_ORDER: WorkflowStage[] = [
  "prepare",
  "understand",
  "implement",
  "verify",
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
    stage: "implement",
    num: 3,
    label: "Implement",
    defaultEvidence: "Pi Session A",
  },
  {
    stage: "verify",
    num: 4,
    label: "Verify",
    defaultEvidence: "Deterministic Checks",
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

const STATUS_TO_STAGE: Record<RunStatus, WorkflowStage | null> = {
  queued: "prepare",
  preparing: "prepare",
  understanding: "understand",
  implementing: "implement",
  verifying: "verify",
  reviewing: "review",
  ready_for_pr: "deliver",
  pr_created: "deliver",
  recovery_required: null,
  failed: null,
  stopped: null,
};

interface WorkflowStepperProps {
  status: RunStatus;
  evidenceByStage?: Record<string, string>;
  stepperId?: string;
}

export function WorkflowStepper({
  status,
  evidenceByStage = {},
  stepperId = "workflow-stepper",
}: WorkflowStepperProps) {
  const currentStage = STATUS_TO_STAGE[status];
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  const getStepClass = (idx: number) => {
    if (
      (status === "failed" ||
        status === "stopped" ||
        status === "recovery_required") &&
      idx === currentIdx
    ) {
      return "failed";
    }
    if (status === "pr_created" || (currentIdx !== -1 && idx < currentIdx)) {
      return "completed";
    }
    if (currentIdx !== -1 && idx === currentIdx) {
      return "active";
    }
    return "";
  };

  return (
    <div className="workflow-stepper card" id={stepperId}>
      <div className="stepper-track">
        {STAGE_CONFIG.map(({ stage, num, label, defaultEvidence }, idx) => {
          const stepCls = getStepClass(idx);
          const evidence = evidenceByStage[stage] || defaultEvidence;

          return (
            <div key={stage} className={`step ${stepCls}`} data-stage={stage}>
              <div className="step-dot">{num}</div>
              <div className="step-label">{label}</div>
              <div className="step-evidence" id={`evidence-${stage}`}>
                {evidence}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
