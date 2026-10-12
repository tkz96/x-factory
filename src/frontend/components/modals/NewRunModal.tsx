// src/frontend/components/modals/NewRunModal.tsx — New Run modal dialog (XFM-46, XFM-47).

import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useModal } from "../../context/ModalContext.js";
import { useCurrentProject } from "../../context/ProjectContext.js";
import { useCreateRun } from "../../hooks/useQueries.js";
import { ActiveRunConflictError } from "../../lib/api-client.js";
import { Dialog, DialogCloseButton, DialogTitle } from "../overlays/Dialog.js";
import { Tooltip, TooltipTrigger } from "../overlays/Tooltip.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import "./NewRunModal.css";

/**
 * The server refuses a run whose Builder or Reviewer role can't resolve, and its
 * reason points at Settings › Models (#278). That pointer becomes a real link.
 */
function needsModelSetup(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Settings › Models");
}

/**
 * A field's help: a focusable, named button whose tooltip opens on hover or
 * keyboard focus. React Aria puts role="tooltip" on the popup and links it to
 * the button with aria-describedby while it is open.
 */
function FieldHelp({
  field,
  title,
  children,
}: {
  field: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger delay={300}>
      <IconButton
        label={`Help: ${field}`}
        icon="icon-info"
        className="ui-icon-button--inline"
      />
      <Tooltip className="field-help-tooltip" placement="bottom start">
        <strong>{title}</strong>
        {children}
      </Tooltip>
    </TooltipTrigger>
  );
}

export function NewRunModal() {
  const { isNewRunOpen, closeNewRunModal, newRunPrefill } = useModal();
  const { selectedProjectId } = useCurrentProject();
  // A ticket's own project wins over the shared scope (#260): in All Projects
  // mode the card that opened the modal names the project it belongs to.
  const targetProjectId = newRunPrefill?.projectId || selectedProjectId;
  const navigate = useNavigate();
  const createRunMutation = useCreateRun();

  const [ticketId, setTicketId] = useState("");
  const [ticketTitle, setTicketTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [criteria, setCriteria] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsRoles, setNeedsRoles] = useState(false);

  // Sync prefill values whenever modal opens or prefill changes
  useEffect(() => {
    if (isNewRunOpen) {
      setError(null);
      setNeedsRoles(false);
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
    if (!targetProjectId) {
      setError("Please select a target project before starting a run.");
      return;
    }
    if (!ticketId.trim() || !ticketTitle.trim() || !plan.trim()) {
      setError("Ticket ID, Ticket Title and Implementation Plan are required.");
      return;
    }

    setError(null);

    const acceptanceCriteria = criteria
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    try {
      const run = await createRunMutation.mutateAsync({
        projectId: targetProjectId,
        ticketId: ticketId.trim(),
        ticketTitle: ticketTitle.trim(),
        branch: branch.trim() || undefined,
        acceptanceCriteria:
          acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
        plan: plan.trim(),
      });

      closeNewRunModal();
      navigate(`/runs/${run.id}`);
    } catch (err: unknown) {
      // The ticket already has an active run (#255): open it instead of showing
      // the refusal as an error. The server named the run to open.
      if (err instanceof ActiveRunConflictError) {
        closeNewRunModal();
        navigate(`/runs/${err.runId}`);
        return;
      }
      setNeedsRoles(needsModelSetup(err));
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // The server refuses a run without a plan, so the form asks for one up
  // front, exactly as it does for the ticket ID and title.
  const isSubmitDisabled =
    !ticketId.trim() ||
    !ticketTitle.trim() ||
    !plan.trim() ||
    createRunMutation.isPending;

  return (
    <Dialog
      isOpen
      onClose={closeNewRunModal}
      id="modal-new-run"
      overlayClassName="modal-backdrop"
      className="modal-dialog"
    >
      <div className="modal-header">
        <DialogTitle id="modal-new-run-title">New Run</DialogTitle>
        <DialogCloseButton id="btn-close-modal" onClose={closeNewRunModal} />
      </div>

      <div className="modal-body">
        <form id="view-setup" className="view active" onSubmit={handleSubmit}>
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="input-ticket-id">Ticket ID</label>
              <FieldHelp field="Ticket ID" title="Ticket Identifier">
                Unique identifier of the ticket in your issue tracker (e.g.{" "}
                <code>VEND-101</code>, <code>#42</code>, or <code>AB#1234</code>
                ).
              </FieldHelp>
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
              <FieldHelp field="Ticket Title" title="Ticket Title">
                Summary description of the task or feature to implement.
              </FieldHelp>
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
              <FieldHelp field="Custom Branch" title="Git Branch">
                Branch name created across all repository worktrees. If left
                blank, X-Factory generates one from the ticket ID and slug.
              </FieldHelp>
            </div>
            <input
              id="input-branch"
              type="text"
              placeholder="auto-generated from the ticket ID"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>

          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="input-criteria">
                Acceptance Criteria (one per line)
              </label>
              <FieldHelp
                field="Acceptance Criteria"
                title="Acceptance Criteria"
              >
                List each testable condition or requirement on its own line. The
                coding agent checks these criteria as it works.
              </FieldHelp>
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
              <FieldHelp
                field="Implementation Plan"
                title="Implementation Plan"
              >
                Step-by-step instructions or architectural guidance for the
                coding agent.
              </FieldHelp>
            </div>
            <textarea
              id="input-plan"
              rows={7}
              placeholder="Paste the step-by-step implementation plan here…"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              required
            />
          </div>

          {error && (
            <div id="setup-error" className="error-message">
              {error}
              {needsRoles && (
                <p className="m-0 mt-2">
                  <Link
                    id="link-settings-models"
                    className="ui-button ui-button--secondary ui-button--sm"
                    to="/settings?tab=models"
                    onClick={closeNewRunModal}
                  >
                    Open Settings › Models
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="modal-actions">
            <Button
              id="btn-cancel-modal"
              variant="secondary"
              isDisabled={createRunMutation.isPending}
              onPress={closeNewRunModal}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              id="btn-start"
              variant="primary"
              isDisabled={isSubmitDisabled}
            >
              {createRunMutation.isPending ? "Starting…" : "Start Run"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
