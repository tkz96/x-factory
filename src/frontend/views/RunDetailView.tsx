// src/frontend/views/RunDetailView.tsx — Canonical Run Detail view with live SSE streaming (XFM-39, XFM-42, XFM-44, XFM-50).

import "./RunDetailView.css";

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActivitySidebar } from "../components/runs/ActivitySidebar.js";
import { HumanCheckpointSection } from "../components/runs/HumanCheckpointSection.js";
import { RunChat } from "../components/runs/RunChat.js";
import { WorkflowStepper } from "../components/runs/WorkflowStepper.js";
import {
  useAbandonRun,
  useResumeRun,
  useRun,
  useTransitionRun,
} from "../hooks/useQueries.js";
import { useRunSSE } from "../hooks/useRunSSE.js";

export function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, error } = useRun(runId);
  const { events, connected } = useRunSSE(run);

  const resumeMutation = useResumeRun();
  const abandonMutation = useAbandonRun();
  const transitionMutation = useTransitionRun();

  const [actionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <section id="area-runs" className="area-view active">
        <div className="empty-state card">
          <div className="spinner-sm" />
          <h3 className="mt-4">Loading Run {runId}…</h3>
        </div>
      </section>
    );
  }

  if (error || !run) {
    return (
      <section id="area-runs" className="area-view active">
        <div className="empty-state card">
          <div className="empty-icon">
            <svg className="icon icon-xl" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-alert-circle" />
            </svg>
          </div>
          <h3>Run Not Found</h3>
          <p className="text-muted">
            No active or historical run matches ID: {runId}
          </p>
          <Link to="/runs" className="btn-secondary btn-sm mt-4">
            ← Back to Runs
          </Link>
        </div>
      </section>
    );
  }

  const isRecoveryRequired = run.status === "recovery_required";
  const isReadyForPr = run.status === "ready_for_pr";

  const handleApprove = () => {
    transitionMutation.mutate({ runId: run.id, action: "approve" });
  };

  const handleRestart = () => {
    transitionMutation.mutate({ runId: run.id, action: "restart" });
  };

  const handleAbort = () => {
    transitionMutation.mutate({ runId: run.id, action: "abort" });
  };

  const handleRequeue = (notes?: string) => {
    transitionMutation.mutate({
      runId: run.id,
      action: "requeue",
      payload: notes ? { chatNotes: notes } : undefined,
    });
  };

  return (
    <section id="area-runs" className="area-view active run-detail-container">
      {/* 2/3 Main + 1/3 Activity Sidebar Layout */}
      <div className="run-detail-layout">
        {/* ── Main Content (2/3) ──────────────────────────────────────── */}
        <div className="run-detail-main">
          {/* Recovery Required Alert */}
          {isRecoveryRequired && (
            <div id="view-run" className="card">
              <div className="recovery-box m-0">
                <div>
                  <strong>Pipeline requires operator recovery</strong>
                  <p className="text-muted text-footnote m-0 mt-1">
                    Worker process terminated or an unexpected state
                    interruption occurred.
                  </p>
                </div>
                <div className="flex-center gap-2">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={resumeMutation.isPending}
                    onClick={() => resumeMutation.mutate(run.id)}
                  >
                    {resumeMutation.isPending ? "Resuming…" : "Resume Run"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm btn-danger-text"
                    disabled={abandonMutation.isPending}
                    onClick={() =>
                      abandonMutation.mutate({
                        runId: run.id,
                        reason: "Abandoned from operator console",
                      })
                    }
                  >
                    {abandonMutation.isPending ? "Abandoning…" : "Abandon Run"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {actionError && (
            <div id="run-error" className="error-message">
              {actionError}
            </div>
          )}

          {/* Universal Run Chat */}
          <RunChat
            run={run}
            events={events}
            onApprove={handleApprove}
            onRestart={handleRestart}
            onAbort={handleAbort}
            onRequeue={handleRequeue}
            isTransitioning={transitionMutation.isPending}
          />

          {/* Human Checkpoint & Delivery */}
          {(isReadyForPr ||
            run.status === "pr_created" ||
            run.status === "awaiting_review") && (
            <div className="checkpoint-container">
              <HumanCheckpointSection
                run={run}
                onApprove={handleApprove}
                onReject={() => handleRequeue("Rejected from human checkpoint")}
              />
            </div>
          )}
        </div>

        {/* ── Activity Sidebar (1/3) ─────────────────────────────────── */}
        <ActivitySidebar events={events} connected={connected} />
      </div>

      {/* 6-Stage Workflow Stepper as Pinned Footer */}
      <footer className="workflow-stepper-footer">
        <WorkflowStepper
          status={run.status}
          startedAt={run.startedAt}
          events={events}
        />
      </footer>
    </section>
  );
}
