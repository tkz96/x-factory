// src/frontend/components/runs/useCheckpointFlow.ts — The run chat's checkpoint steps: what a checkpoint
// button does (asking first to abandon, opening the rework prompt), the rework notes awaiting
// confirmation, and the line that says what was just pressed. A new status starts these over.

import { type RefObject, useEffect, useRef, useState } from "react";
import type { RunStatus } from "../../../shared/types.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import type { CheckpointAction } from "./RunCheckpointBar.js";

/** The line the chat shows once a button has been pressed, before the run moves on. */
function resolvedTextFor(
  action: CheckpointAction,
  status: RunStatus,
): string | null {
  switch (action) {
    case "approve":
      return status === "awaiting_review" ? "Changes approved" : "Approved";
    case "restart":
      return "Changes requested";
    case "deliver":
      return "Opening a pull request";
    case "resume":
      return "Resuming the run";
    case "retry-review":
      return "Retrying the review";
    case "abandon":
      return "Abandoned";
    case "start-new-run":
    case "requeue":
    case "confirm-rework":
      return null;
  }
}

/**
 * What Request Changes sends from a status, and the notice that asks for the notes. The server
 * routes each the same way (`RESTART_ROUTES` and `REQUEUE_ROUTE` in src/workflow.ts): Review goes
 * back to planning, Understand and Plan run again.
 */
const REWORK_BY_STATUS: Partial<
  Record<RunStatus, { action: "requeue" | "restart"; notice: string }>
> = {
  awaiting_review: {
    action: "requeue",
    notice:
      "Describe the changes needed. Your next message goes back to planning.",
  },
  awaiting_understanding_approval: {
    action: "restart",
    notice:
      "Describe the changes needed. Your next message goes back to Understand.",
  },
  awaiting_plan_approval: {
    action: "restart",
    notice: "Describe the changes needed. Plan runs again with it.",
  },
};

const DEFAULT_REWORK = {
  action: "restart",
  notice:
    "Describe the changes needed. Your next message goes into the next try.",
} as const;

interface CheckpointFlowOptions {
  status: RunStatus;
  onAction?: ((action: CheckpointAction, notes?: string) => void) | undefined;
  addLocal: (make: (id: string, at: string) => ChatItem) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function useCheckpointFlow({
  status,
  onAction,
  addLocal,
  inputRef,
}: CheckpointFlowOptions) {
  const [reworkPrompt, setReworkPrompt] = useState(false);
  const [pendingRework, setPendingRework] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);

  // A new status starts the chat's pending steps over: they answered the old status.
  const lastStatusRef = useRef(status);
  useEffect(() => {
    if (lastStatusRef.current !== status) {
      lastStatusRef.current = status;
      setReworkPrompt(false);
      setPendingRework(null);
      setResolved(null);
    }
  }, [status]);

  const rework = REWORK_BY_STATUS[status] ?? DEFAULT_REWORK;

  const handleAction = (action: CheckpointAction) => {
    // Abandoning cannot be undone: ask first, naming the branch (#262).
    if (action === "abandon") {
      setAbandonOpen(true);
      return;
    }
    if (action === "requeue" || action === "restart") {
      setReworkPrompt(true);
      addLocal((id, at) => ({
        id,
        at,
        kind: "notice",
        text: rework.notice,
        warning: false,
      }));
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    if (action === "confirm-rework") {
      onAction?.(rework.action, pendingRework ?? undefined);
      setPendingRework(null);
      setResolved(resolvedTextFor(rework.action, status));
      return;
    }
    onAction?.(action);
    setResolved(resolvedTextFor(action, status));
  };

  const confirmAbandon = () => {
    onAction?.("abandon");
    setResolved(resolvedTextFor("abandon", status));
  };

  return {
    reworkPrompt,
    setReworkPrompt,
    pendingRework,
    setPendingRework,
    resolved,
    abandonOpen,
    setAbandonOpen,
    handleAction,
    confirmAbandon,
  };
}
