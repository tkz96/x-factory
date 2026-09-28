// src/frontend/components/runs/ReviewAndRequeueSection.tsx — Unified Diff & Requeue Form (Phase 3).

import "./ReviewAndRequeueSection.css";
import { useMemo, useState } from "react";
import type { Run } from "../../../shared/types.js";
import { useTransitionRun } from "../../hooks/useQueries.js";

interface ReviewAndRequeueSectionProps {
  run: Run;
}

export function ReviewAndRequeueSection({ run }: ReviewAndRequeueSectionProps) {
  const transitionMutation = useTransitionRun();
  const [chatNotes, setChatNotes] = useState("");
  const [failingTasks, setFailingTasks] = useState<Set<string>>(new Set());

  // Naive extraction of tasks from plan
  const tasks = useMemo(() => {
    if (!run.plan) return [];
    const lines = run.plan.split("\n").map((l) => l.trim());
    return lines
      .filter((l) => l.startsWith("- [ ]") || l.startsWith("- [x]"))
      .map((l) => l.replace(/^-\s+\[[ x]\]\s+/i, ""));
  }, [run.plan]);

  const toggleTask = (task: string) => {
    const next = new Set(failingTasks);
    if (next.has(task)) {
      next.delete(task);
    } else {
      next.add(task);
    }
    setFailingTasks(next);
  };

  const handleRequeue = () => {
    transitionMutation.mutate({
      runId: run.id,
      action: "requeue",
      payload: {
        failingTasks: Array.from(failingTasks),
        chatNotes: chatNotes.trim(),
      },
    });
  };

  const handleApprove = () => {
    transitionMutation.mutate({
      runId: run.id,
      action: "approve",
    });
  };

  return (
    <div className="card mt-4" id="review-requeue-section">
      <div className="run-header">
        <h2 id="result-heading">Review & Requeue</h2>
      </div>

      <div className="review-requeue-content">
        {/* Unified Diff Viewer */}
        <div className="review-diff-container">
          <h3>Unified Diff</h3>
          <pre className="diff-viewer review-diff-pre">
            {run.diff || "No diff available."}
          </pre>
        </div>

        {/* Task List & Review Notes */}
        <div className="review-sidebar">
          <div>
            <h3>Task List</h3>
            <p className="text-muted text-footnote mt-1">
              Select tasks that failed to meet criteria:
            </p>
            <ul className="review-task-list">
              {tasks.length > 0 ? (
                tasks.map((task, i) => (
                  <li key={task} className="review-task-item">
                    <input
                      type="checkbox"
                      checked={failingTasks.has(task)}
                      onChange={() => toggleTask(task)}
                      id={`task-${i}`}
                      className="review-task-checkbox"
                    />
                    <label htmlFor={`task-${i}`} className="review-task-label">
                      {task}
                    </label>
                  </li>
                ))
              ) : (
                <li className="text-muted text-sm">
                  No specific tasks found in plan.
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3>Review Notes</h3>
            <textarea
              className="review-notes-textarea"
              value={chatNotes}
              onChange={(e) => setChatNotes(e.target.value)}
              placeholder="Provide freeform review notes..."
              rows={5}
            />
          </div>

          <div className="review-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleRequeue}
              disabled={transitionMutation.isPending}
            >
              {transitionMutation.isPending ? "Processing..." : "Requeue Run"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleApprove}
              disabled={transitionMutation.isPending}
            >
              Approve (PR)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
