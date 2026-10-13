// src/frontend/views/RunDetailView.tsx — The run page (#262, spec #241): the now header, one chat of
// real events, the checkpoint bar above the message box, and the inspector. Every action goes
// through the server's guards; the bar only offers what the status map allows.

import "./RunDetailView.css";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RunChat } from "../components/runs/RunChat.js";
import type { CheckpointAction } from "../components/runs/RunCheckpointBar.js";
import {
  RunInspector,
  RunInspectorSheet,
} from "../components/runs/RunInspector.js";
import { RunModelsCard } from "../components/runs/RunModelsCard.js";
import { WorkflowStepper } from "../components/runs/WorkflowStepper.js";
import { useMediaQuery } from "../components/ui/useMediaQuery.js";
import {
  useAbandonRun,
  useCreateRun,
  usePrRun,
  useResumeRun,
  useTransitionRun,
} from "../hooks/useQueries.js";
import { useRunDetail } from "../hooks/useRunDetail.js";
import { ActiveRunConflictError, ApiError } from "../lib/api-client.js";
import { refreshRunAfterMutation } from "../lib/run-state.js";

/** The refusal of a checkpoint action whose run moved on first (a stale or illegal transition). */
function movedOn(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  const { run, isLoading, error, events, connected } = useRunDetail(runId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const transitionMutation = useTransitionRun();
  const resumeMutation = useResumeRun();
  const abandonMutation = useAbandonRun();
  const deliverMutation = usePrRun();
  const createRunMutation = useCreateRun();

  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const isPhone = useMediaQuery("(max-width: 768px)");

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
          <Link
            to="/runs"
            className="ui-button ui-button--secondary ui-button--sm mt-4"
          >
            ← Back to Runs
          </Link>
        </div>
      </section>
    );
  }

  const runAction = async (perform: () => Promise<unknown>) => {
    setActionError(null);
    setConflict(false);
    try {
      await perform();
    } catch (err: unknown) {
      if (movedOn(err)) {
        // The run moved on before this action landed: show the latest, say so.
        setConflict(true);
        refreshRunAfterMutation(queryClient, run.id);
        return;
      }
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const startNewRun = async () => {
    setActionError(null);
    setConflict(false);
    try {
      const next = await createRunMutation.mutateAsync({
        projectId: run.project.id,
        ticketId: run.ticket.id,
        ticketTitle: run.ticket.title,
        acceptanceCriteria: run.ticket.acceptanceCriteria,
        // The server refuses a run without a plan: the new run starts from
        // the same plan and ticket description this one had.
        plan: run.plan,
        ...(run.ticket.description
          ? { description: run.ticket.description }
          : {}),
      });
      navigate(`/runs/${next.id}`);
    } catch (err: unknown) {
      // The ticket already has an active run (#255): open that one. This run is untouched.
      if (err instanceof ActiveRunConflictError) {
        navigate(`/runs/${err.runId}`);
        return;
      }
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const onAction = (action: CheckpointAction, notes?: string) => {
    switch (action) {
      case "approve":
        void runAction(() =>
          transitionMutation.mutateAsync({ runId: run.id, action: "approve" }),
        );
        return;
      case "restart":
        void runAction(() =>
          transitionMutation.mutateAsync({ runId: run.id, action: "restart" }),
        );
        return;
      case "requeue":
        void runAction(() =>
          transitionMutation.mutateAsync({
            runId: run.id,
            action: "requeue",
            payload: notes ? { chatNotes: notes } : undefined,
          }),
        );
        return;
      case "deliver":
        void runAction(() => deliverMutation.mutateAsync({ runId: run.id }));
        return;
      case "resume":
        void runAction(() => resumeMutation.mutateAsync(run.id));
        return;
      case "abandon":
        void runAction(() =>
          abandonMutation.mutateAsync({
            runId: run.id,
            reason: "chosen on the run page",
          }),
        );
        return;
      case "start-new-run":
        void startNewRun();
        return;
      case "confirm-rework":
        return;
    }
  };

  // The one action in flight, so the bar can label it and disable its siblings.
  const pending: CheckpointAction | null = transitionMutation.isPending
    ? transitionMutation.variables?.action === "restart"
      ? "restart"
      : transitionMutation.variables?.action === "approve"
        ? "approve"
        : "requeue"
    : resumeMutation.isPending
      ? "resume"
      : abandonMutation.isPending
        ? "abandon"
        : deliverMutation.isPending
          ? "deliver"
          : createRunMutation.isPending
            ? "start-new-run"
            : null;

  const inspectorProps = { run, events, connected };

  return (
    <section id="area-runs" className="area-view active run-detail-container">
      <div className="run-detail-layout">
        <div className="run-detail-main">
          <RunModelsCard stageModels={run.stageModels ?? []} />
          {isPhone && (
            <div className="run-detail-toolbar">
              <RunInspectorSheet {...inspectorProps} />
            </div>
          )}

          {actionError && (
            <div id="run-error" className="error-message">
              {actionError}
            </div>
          )}

          <RunChat
            run={run}
            events={events}
            onAction={onAction}
            pending={pending}
            conflict={conflict}
          />
        </div>

        {!isPhone && <RunInspector {...inspectorProps} />}
      </div>

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
