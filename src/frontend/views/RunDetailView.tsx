// src/frontend/views/RunDetailView.tsx — Canonical Run Detail view with live SSE streaming (XFM-39, XFM-42, XFM-44, XFM-50).

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
          <h3 style={{ marginTop: "1rem" }}>Loading Run {runId}…</h3>
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
          <Link
            to="/runs"
            className="btn-secondary btn-sm"
            style={{ marginTop: "1rem" }}
          >
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

  const rawEvents = events.map((e) => e.event);

  return (
    <section id="area-runs" className="area-view active">
      {/* 6-Stage Workflow Stepper */}
      <WorkflowStepper status={run.status} />

      {/* Main Execution View */}
      <div id="view-run" className="view active">
        <div className="card" style={{ marginTop: "1.2rem" }}>
          <div className="run-header">
            <div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <Link
                  to="/runs"
                  className="text-muted text-xs"
                  style={{ textDecoration: "none" }}
                >
                  ← Runs /
                </Link>
                <h2 id="run-title" style={{ margin: 0 }}>
                  #{run.ticket?.id || run.id} — {run.ticket?.title || "Task"}
                </h2>
              </div>
              <span
                id="run-branch"
                className="code-sub"
                style={{ display: "block", marginTop: "0.3rem" }}
              >
                {run.project?.name} ·{" "}
                <code style={{ fontSize: "0.85rem" }}>{run.branch}</code>
              </span>
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
            >
              {connected && !isTerminal && (
                <span
                  className="status-dot online"
                  title="Live SSE stream connected"
                  style={{ width: "8px", height: "8px" }}
                />
              )}
              <span id="run-status" className="badge" data-status={run.status}>
                {run.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Recovery Required Actions */}
          {isRecoveryRequired && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.8rem 1rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-danger-subtle)",
                border: "1px solid var(--danger)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.8rem",
              }}
            >
              <div>
                <strong>Pipeline requires operator recovery</strong>
                <p
                  className="text-muted"
                  style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}
                >
                  Worker process terminated or an unexpected state interruption
                  occurred.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
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
                  className="btn-secondary btn-sm"
                  style={{ color: "var(--danger)" }}
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
          <h3 style={{ marginTop: "1.2rem", marginBottom: "0.5rem" }}>
            Live Activity
          </h3>
          <EventLogViewer events={rawEvents} />

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
            <div className="run-actions" style={{ marginTop: "1rem" }}>
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
            <div
              id="run-error"
              className="error-message"
              style={{ marginTop: "0.8rem" }}
            >
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
