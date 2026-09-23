// src/frontend/views/RunDetailView.tsx — Canonical Run Detail view with live SSE streaming (XFM-39, XFM-42, XFM-44, XFM-50).

import "./RunDetailView.css";

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DiffViewer } from "../components/runs/DiffViewer.js";
import { EventLogViewer } from "../components/runs/EventLogViewer.js";
import { HumanCheckpointSection } from "../components/runs/HumanCheckpointSection.js";
import { WorkflowStepper } from "../components/runs/WorkflowStepper.js";
import {
  useAbandonRun,
  useResumeRun,
  useRun,
  useSteerRun,
} from "../hooks/useQueries.js";
import { useRunSSE } from "../hooks/useRunSSE.js";
import { api } from "../lib/api-client.js";

export function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, error, refetch } = useRun(runId);
  const { events, connected } = useRunSSE(run);

  const steerMutation = useSteerRun();
  const resumeMutation = useResumeRun();
  const abandonMutation = useAbandonRun();

  const [steerMessage, setSteerMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

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
  const isTerminal =
    run.status === "pr_created" ||
    run.status === "failed" ||
    run.status === "stopped";
  const isReadyForPr = run.status === "ready_for_pr";

  const handleSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerMessage.trim() || steerMutation.isPending) return;
    setActionError(null);
    try {
      await steerMutation.mutateAsync({
        runId: run.id,
        message: steerMessage.trim(),
      });
      setSteerMessage("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = async () => {
    if (!confirm("Are you sure you want to stop this run?")) return;
    setStopping(true);
    setActionError(null);
    try {
      await api.stopRun(run.id);
      void refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  return (
    <section id="area-runs" className="area-view active">
      {/* 6-Stage Workflow Stepper */}
      <WorkflowStepper status={run.status} />

      {/* Main Execution View */}
      <div id="view-run" className="view active">
        <div className="card mt-4">
          <div className="run-header">
            <div>
              <div className="flex-center gap-2">
                <Link to="/runs" className="text-muted text-xs">
                  ← Runs /
                </Link>
                <h2 id="run-title">
                  #{run.ticket?.id || run.id} — {run.ticket?.title || "Task"}
                </h2>
              </div>
              <span id="run-branch" className="code-sub">
                {run.project?.name} · <code>{run.branch}</code>
              </span>
            </div>
            <div className="flex-center gap-3">
              {connected && !isTerminal && (
                <span
                  className="status-dot status-dot-sm online"
                  title="Live SSE stream connected"
                />
              )}
              <span id="run-status" className="badge" data-status={run.status}>
                {run.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Recovery Required Actions */}
          {isRecoveryRequired && (
            <div className="recovery-box">
              <div>
                <strong>Pipeline requires operator recovery</strong>
                <p className="text-muted text-footnote m-0 mt-1">
                  Worker process terminated or an unexpected state interruption
                  occurred.
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
          )}

          {/* Live Activity Log */}
          <h3 className="mt-4 mb-2">Live Activity</h3>
          <EventLogViewer events={events} />

          {/* Steer Bar */}
          {!isTerminal && !isRecoveryRequired && !isReadyForPr && (
            <form id="steer-bar" className="steer-bar" onSubmit={handleSteer}>
              <input
                id="input-steer"
                type="text"
                placeholder="Send steering instruction to active Pi session…"
                value={steerMessage}
                onChange={(e) => setSteerMessage(e.target.value)}
                disabled={steerMutation.isPending}
              />
              <button
                type="submit"
                id="btn-steer"
                className="btn-secondary"
                disabled={!steerMessage.trim() || steerMutation.isPending}
              >
                {steerMutation.isPending ? "Sending…" : "Steer"}
              </button>
            </form>
          )}

          {/* Run Control Actions */}
          {!isTerminal && !isRecoveryRequired && !isReadyForPr && (
            <div className="run-actions mt-4">
              <button
                type="button"
                id="btn-stop"
                className="btn-danger"
                onClick={handleStop}
                disabled={stopping}
              >
                {stopping ? "Stopping…" : "Stop Run"}
              </button>
            </div>
          )}

          {actionError && (
            <div id="run-error" className="error-message mt-3">
              {actionError}
            </div>
          )}
        </div>

        {/* Live Diff Preview */}
        <DiffViewer diff={run.diff} />

        {/* Human Checkpoint & Delivery */}
        {(isReadyForPr || run.status === "pr_created") && (
          <HumanCheckpointSection run={run} />
        )}
      </div>
    </section>
  );
}
