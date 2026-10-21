// src/frontend/components/runs/useRunCheckpointActions.ts — The run page's actions: what a checkpoint
// button performs through the server, the one action in flight (so the bar can label it), and the
// refusal shown when the run moved on before the action landed. A new run starts these over.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAbandonRun,
  useCreateRun,
  usePrRun,
  useResumeRun,
  useRetryReview,
  useTransitionRun,
} from "../../hooks/useQueries.js";
import type { useRunDetail } from "../../hooks/useRunDetail.js";
import { ActiveRunConflictError, ApiError } from "../../lib/api-client.js";
import { refreshRunAfterMutation } from "../../lib/run-state.js";
import type { CheckpointAction } from "./RunCheckpointBar.js";

export type LoadedRun = NonNullable<ReturnType<typeof useRunDetail>["run"]>;

/** The refusal of a checkpoint action whose run moved on first (a stale or illegal transition). */
function movedOn(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** Which action is in flight, from each mutation's pending state. */
function pendingActionOf(flags: {
  transitionPending: boolean;
  transitionAction: string | undefined;
  resumePending: boolean;
  retryReviewPending: boolean;
  abandonPending: boolean;
  deliverPending: boolean;
  createRunPending: boolean;
}): CheckpointAction | null {
  if (flags.transitionPending) {
    if (flags.transitionAction === "restart") return "restart";
    if (flags.transitionAction === "approve") return "approve";
    return "requeue";
  }
  if (flags.resumePending) return "resume";
  if (flags.retryReviewPending) return "retry-review";
  if (flags.abandonPending) return "abandon";
  if (flags.deliverPending) return "deliver";
  if (flags.createRunPending) return "start-new-run";
  return null;
}

export function useRunCheckpointActions(
  runId: string | undefined,
  run: LoadedRun,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const transitionMutation = useTransitionRun();
  const resumeMutation = useResumeRun();
  const retryReviewMutation = useRetryReview();
  const abandonMutation = useAbandonRun();
  const deliverMutation = usePrRun();
  const createRunMutation = useCreateRun();

  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // A new run starts with a clean slate: the last run's action error or conflict does not follow
  // the reader into it.
  const lastRunIdRef = useRef(runId);
  useEffect(() => {
    if (lastRunIdRef.current === runId) return;
    lastRunIdRef.current = runId;
    setActionError(null);
    setConflict(false);
  }, [runId]);

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
        // The new run starts from the same plan and ticket description this one had.
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
      case "retry-review":
        void runAction(() => retryReviewMutation.mutateAsync(run.id));
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

  const pending = pendingActionOf({
    transitionPending: transitionMutation.isPending,
    transitionAction: transitionMutation.variables?.action,
    resumePending: resumeMutation.isPending,
    retryReviewPending: retryReviewMutation.isPending,
    abandonPending: abandonMutation.isPending,
    deliverPending: deliverMutation.isPending,
    createRunPending: createRunMutation.isPending,
  });

  return { actionError, conflict, pending, onAction };
}
