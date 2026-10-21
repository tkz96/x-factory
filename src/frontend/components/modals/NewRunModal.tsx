// src/frontend/components/modals/NewRunModal.tsx — New Run window (XFM-46,
// XFM-47).
//
// New Run is the add-project assistant's window: the same Sheet, the same
// DialogHeader/DialogBody/DialogFooter structure, the same --sheet-width
// (DESIGN.md §6 "the one window"), and the control vocabulary's fields instead
// of raw inputs.
// It stays mounted and is told whether it is open, so closing plays the shared
// exit instead of vanishing with the mount (#250).

import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useModal } from "../../context/ModalContext.js";
import { useCurrentProject } from "../../context/ProjectContext.js";
import { useCreateRun } from "../../hooks/useQueries.js";
import { ActiveRunConflictError } from "../../lib/api-client.js";
import {
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../overlays/Dialog.js";
import { Sheet } from "../overlays/Sheet.js";
import { Tooltip, TooltipTrigger } from "../overlays/Tooltip.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { TextAreaField, TextField } from "../ui/TextField.js";
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

/** Shown on the run a second New Run for the same ticket opens instead. */
const ACTIVE_RUN_NOTICE =
  "A run for this ticket is already active, so your new input was not used. Showing that run.";

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
        setPlan(newRunPrefill.plan ?? "");
      } else {
        setTicketId("");
        setTicketTitle("");
        setBranch("");
        setCriteria("");
        setPlan("");
      }
    }
  }, [isNewRunOpen, newRunPrefill]);

  const submit = async () => {
    if (!targetProjectId) {
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
      // the refusal as an error. The server named the run to open, and the
      // reader is told the new input was not used.
      if (err instanceof ActiveRunConflictError) {
        closeNewRunModal();
        navigate(`/runs/${err.runId}`, {
          state: { notice: ACTIVE_RUN_NOTICE },
        });
        return;
      }
      setNeedsRoles(needsModelSetup(err));
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // The form still submits on Enter; the footer's Start Run sits outside it, so
  // it calls the same routine directly.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  // The plan is optional: the Builder writes one when the form leaves it empty.
  const isSubmitDisabled =
    !ticketId.trim() || !ticketTitle.trim() || createRunMutation.isPending;

  return (
    <Sheet
      isOpen={isNewRunOpen}
      onClose={closeNewRunModal}
      id="modal-new-run"
      position="center"
      title="New Run"
      className="new-run-sheet"
    >
      <DialogHeader>
        <DialogTitle id="modal-new-run-title">New Run</DialogTitle>
        <DialogCloseButton id="btn-close-modal" onClose={closeNewRunModal} />
      </DialogHeader>

      <DialogBody>
        <form id="view-setup" className="new-run-form" onSubmit={handleSubmit}>
          <TextField
            label="Ticket ID"
            inputId="input-ticket-id"
            placeholder="e.g. PROJ-101"
            value={ticketId}
            onChange={setTicketId}
            isRequired
            labelAccessory={
              <FieldHelp field="Ticket ID" title="Ticket Identifier">
                Unique identifier of the ticket in your issue tracker (e.g.{" "}
                <code>VEND-101</code>, <code>#42</code>, or <code>AB#1234</code>
                ).
              </FieldHelp>
            }
          />

          <TextField
            label="Ticket Title"
            inputId="input-ticket-title"
            placeholder="e.g. Implement password reset rate limiting"
            value={ticketTitle}
            onChange={setTicketTitle}
            isRequired
            labelAccessory={
              <FieldHelp field="Ticket Title" title="Ticket Title">
                Summary description of the task or feature to implement.
              </FieldHelp>
            }
          />

          <TextField
            label="Branch (optional)"
            inputId="input-branch"
            placeholder="auto-generated from the ticket ID"
            description="Created across every repository worktree. Leave it blank and X-Factory names it from the ticket ID and slug."
            value={branch}
            onChange={setBranch}
          />

          <TextAreaField
            label="Acceptance criteria"
            inputId="input-criteria"
            rows={4}
            placeholder={
              "- Return 429 after 5 failed attempts\n- Reset counter after 15 minutes\n- Add unit tests for window expiration"
            }
            value={criteria}
            onChange={setCriteria}
            labelAccessory={
              <FieldHelp
                field="Acceptance Criteria"
                title="Acceptance Criteria"
              >
                List each testable condition or requirement on its own line. The
                coding agent checks these criteria as it works.
              </FieldHelp>
            }
          />

          <TextAreaField
            label="Implementation plan"
            inputId="input-plan"
            rows={7}
            placeholder="Paste the step-by-step implementation plan here…"
            value={plan}
            onChange={setPlan}
            labelAccessory={
              <FieldHelp
                field="Implementation Plan"
                title="Implementation Plan"
              >
                Step-by-step instructions or architectural guidance for the
                coding agent.
              </FieldHelp>
            }
          />

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
        </form>
      </DialogBody>

      <DialogFooter>
        <Button
          id="btn-cancel-modal"
          variant="secondary"
          isDisabled={createRunMutation.isPending}
          onPress={closeNewRunModal}
        >
          Cancel
        </Button>
        <Button
          id="btn-start"
          variant="primary"
          isDisabled={isSubmitDisabled}
          onPress={submit}
        >
          {createRunMutation.isPending ? "Starting…" : "Start Run"}
        </Button>
      </DialogFooter>
    </Sheet>
  );
}
