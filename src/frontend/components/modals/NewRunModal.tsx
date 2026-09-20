// src/frontend/components/modals/NewRunModal.tsx — New Factory Run modal dialog (XFM-46, XFM-47).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModal } from "../../context/ModalContext.js";
import { useCurrentProject } from "../../context/ProjectContext.js";
import { useCreateRun } from "../../hooks/useQueries.js";

export function NewRunModal() {
  const { isNewRunOpen, closeNewRunModal, newRunPrefill } = useModal();
  const { selectedProjectId } = useCurrentProject();
  const navigate = useNavigate();
  const createRunMutation = useCreateRun();

  const [ticketId, setTicketId] = useState("");
  const [ticketTitle, setTicketTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [criteria, setCriteria] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Sync prefill values whenever modal opens or prefill changes
  useEffect(() => {
    if (isNewRunOpen) {
      setError(null);
      if (newRunPrefill) {
        setTicketId(newRunPrefill.ticketId || "");
        setTicketTitle(newRunPrefill.ticketTitle || "");
        setBranch(newRunPrefill.branch || "");
        setCriteria((newRunPrefill.criteria || []).join("\n"));
        setPlan(
          newRunPrefill.plan ||
            (newRunPrefill.ticketTitle
              ? `1. Understand requirements\n2. Implement changes for ${newRunPrefill.ticketTitle}\n3. Verify test suite passes\n4. Review and deliver`
              : ""),
        );
      } else {
        setTicketId("");
        setTicketTitle("");
        setBranch("");
        setCriteria("");
        setPlan("");
      }
    }
  }, [isNewRunOpen, newRunPrefill]);

  if (!isNewRunOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      setError("Please select a target project before starting a run.");
      return;
    }
    if (!ticketId.trim() || !ticketTitle.trim()) {
      setError("Ticket ID and Ticket Title are required.");
      return;
    }

    setError(null);

    const acceptanceCriteria = criteria
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    try {
      const run = await createRunMutation.mutateAsync({
        projectId: selectedProjectId,
        ticketId: ticketId.trim(),
        ticketTitle: ticketTitle.trim(),
        branch: branch.trim() || undefined,
        acceptanceCriteria:
          acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
        plan: plan.trim() || undefined,
      });

      closeNewRunModal();
      navigate(`/runs/${run.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isSubmitDisabled =
    !ticketId.trim() || !ticketTitle.trim() || createRunMutation.isPending;

  return (
    <div
      id="modal-new-run"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-new-run-title"
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 id="modal-new-run-title">New Factory Run</h2>
          <button
            type="button"
            id="btn-close-modal"
            className="btn-close"
            aria-label="Close dialog"
            onClick={closeNewRunModal}
          >
            <svg className="icon icon-xs" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-x" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <form id="view-setup" className="view active" onSubmit={handleSubmit}>
            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="input-ticket-id">Ticket ID</label>
                <span
                  className="tooltip-badge"
                  role="tooltip"
                  aria-label="Help: Ticket ID"
                >
                  ?
                  <span className="tooltip-popover">
                    <strong>Ticket Identifier</strong>
                    Unique identifier of the ticket in your issue tracker (e.g.{" "}
                    <code>VEND-101</code>, <code>#42</code>, or{" "}
                    <code>AB#1234</code>).
                  </span>
                </span>
              </div>
              <input
                id="input-ticket-id"
                type="text"
                placeholder="e.g. PROJ-101"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="input-ticket-title">Ticket Title</label>
                <span
                  className="tooltip-badge"
                  role="tooltip"
                  aria-label="Help: Ticket Title"
                >
                  ?
                  <span className="tooltip-popover">
                    <strong>Ticket Title</strong>
                    Summary description of the task or feature to implement.
                  </span>
                </span>
              </div>
              <input
                id="input-ticket-title"
                type="text"
                placeholder="e.g. Implement password reset rate limiting"
                value={ticketTitle}
                onChange={(e) => setTicketTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="input-branch">
                  Custom Branch (Optional — auto-generated if blank)
                </label>
                <span
                  className="tooltip-badge"
                  role="tooltip"
                  aria-label="Help: Custom Branch"
                >
                  ?
                  <span className="tooltip-popover">
                    <strong>Git Branch</strong>
                    Branch name created across all repository worktrees. If left
                    blank, X-Factory generates one from the ticket ID and slug.
                  </span>
                </span>
              </div>
              <input
                id="input-branch"
                type="text"
                placeholder="factory/ticket-slug (auto-generated)"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>

            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="input-criteria">
                  Acceptance Criteria (one per line)
                </label>
                <span
                  className="tooltip-badge"
                  role="tooltip"
                  aria-label="Help: Acceptance Criteria"
                >
                  ?
                  <span className="tooltip-popover">
                    <strong>Acceptance Criteria</strong>
                    List each testable condition or requirement on its own line.
                    Pi checks these criteria during the Test &amp; Verify stage.
                  </span>
                </span>
              </div>
              <textarea
                id="input-criteria"
                rows={4}
                placeholder="- Return 429 after 5 failed attempts&#10;- Reset counter after 15 minutes&#10;- Add unit tests for window expiration"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </div>

            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="input-plan">Implementation Plan</label>
                <span
                  className="tooltip-badge"
                  role="tooltip"
                  aria-label="Help: Implementation Plan"
                >
                  ?
                  <span className="tooltip-popover">
                    <strong>Implementation Plan</strong>
                    Step-by-step instructions or architectural guidance for the
                    coding agent.
                  </span>
                </span>
              </div>
              <textarea
                id="input-plan"
                rows={7}
                placeholder="Paste the step-by-step implementation plan here…"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </div>

            {error && (
              <div id="setup-error" className="error-message">
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                id="btn-cancel-modal"
                className="btn-secondary"
                onClick={closeNewRunModal}
                disabled={createRunMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                id="btn-start"
                className="btn-primary"
                disabled={isSubmitDisabled}
              >
                {createRunMutation.isPending
                  ? "Starting…"
                  : "Start Factory Run"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
