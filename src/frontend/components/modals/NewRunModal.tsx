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
import { type NewRunPrefill, useModal } from "../../context/ModalContext.js";
import { useCurrentProject } from "../../context/ProjectContext.js";
import { useCreateRun } from "../../hooks/useQueries.js";
import { ActiveRunConflictError } from "../../lib/api-client.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
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
        {/* The text styles sit on the tooltip's content, so the primitive's
            own caption size never decides what the guidance reads at. */}
        <div className="text-subhead">
          <strong className="font-semibold">{title}</strong>
          {children}
        </div>
      </Tooltip>
    </TooltipTrigger>
  );
}

/** Shown on the run a second New Run for the same ticket opens instead. */
const ACTIVE_RUN_NOTICE =
  "A run for this ticket is already active, so your new input was not used. Showing that run.";

/** What the form edits. Every field is text; the criteria are one per line. */
interface NewRunDraft {
  ticketId: string;
  ticketTitle: string;
  description: string;
  branch: string;
  criteria: string;
  plan: string;
}

type DraftField = keyof NewRunDraft;

const EMPTY_DRAFT: NewRunDraft = {
  ticketId: "",
  ticketTitle: "",
  description: "",
  branch: "",
  criteria: "",
  plan: "",
};

/** A ticket's prefill fills the form; no prefill leaves every field empty. */
function draftFromPrefill(prefill: NewRunPrefill | null): NewRunDraft {
  if (!prefill) return EMPTY_DRAFT;
  return {
    ticketId: prefill.ticketId || "",
    ticketTitle: prefill.ticketTitle || "",
    description: prefill.description ?? "",
    branch: prefill.branch || "",
    criteria: (prefill.criteria || []).join("\n"),
    plan: prefill.plan ?? "",
  };
}

/** One criterion per line; blank lines are dropped. */
function parseCriteria(text: string): string[] {
  return text
    .split("\n")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** The message for a draft missing a required field, or null when it is complete. */
function missingFieldMessage(draft: NewRunDraft): string | null {
  return !draft.ticketId.trim() || !draft.ticketTitle.trim()
    ? "Ticket ID and Ticket Title are required."
    : null;
}

/** The request for a run. The plan is optional: the Builder writes one when it is empty. */
function buildCreateRunInput(projectId: string, draft: NewRunDraft) {
  const acceptanceCriteria = parseCriteria(draft.criteria);
  return {
    projectId,
    ticketId: draft.ticketId.trim(),
    ticketTitle: draft.ticketTitle.trim(),
    description: draft.description.trim() || undefined,
    branch: draft.branch.trim() || undefined,
    acceptanceCriteria:
      acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    plan: draft.plan.trim(),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The draft the form edits. It is refilled from the prefill each time the
 * window opens, and the error from the last attempt is cleared then too.
 */
function useNewRunDraft(isOpen: boolean, prefill: NewRunPrefill | null) {
  const [draft, setDraft] = useState<NewRunDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [needsRoles, setNeedsRoles] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setNeedsRoles(false);
      setDraft(draftFromPrefill(prefill));
    }
  }, [isOpen, prefill]);

  const setField = (field: DraftField) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return { draft, setField, error, setError, needsRoles, setNeedsRoles };
}

function NewRunError({
  message,
  needsRoles,
  onOpenSettings,
}: {
  message: string;
  needsRoles: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div id="setup-error">
      <FeedbackBanner
        tone="error"
        message={
          <>
            {message}
            {needsRoles && (
              <span className="mt-2">
                <Link
                  id="link-settings-models"
                  className="ui-button ui-button--secondary ui-button--sm"
                  to="/settings?tab=models"
                  onClick={onOpenSettings}
                >
                  Open Settings › Models
                </Link>
              </span>
            )}
          </>
        }
      />
    </div>
  );
}

/** The fields and the refusal they lead to. The form submits on Enter. */
function NewRunForm({
  draft,
  setField,
  error,
  needsRoles,
  onSubmit,
  onOpenSettings,
}: {
  draft: NewRunDraft;
  setField: (field: DraftField) => (value: string) => void;
  error: string | null;
  needsRoles: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onOpenSettings: () => void;
}) {
  return (
    <form id="view-setup" className="new-run-form" onSubmit={onSubmit}>
      <TextField
        label="Ticket ID"
        inputId="input-ticket-id"
        placeholder="e.g. PROJ-101"
        value={draft.ticketId}
        onChange={setField("ticketId")}
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
        value={draft.ticketTitle}
        onChange={setField("ticketTitle")}
        isRequired
        labelAccessory={
          <FieldHelp field="Ticket Title" title="Ticket Title">
            Summary description of the task or feature to implement.
          </FieldHelp>
        }
      />

      <TextAreaField
        label="Description"
        inputId="input-description"
        rows={5}
        placeholder="What the ticket asks for, in the tracker's own words…"
        value={draft.description}
        onChange={setField("description")}
        labelAccessory={
          <FieldHelp field="Description" title="Ticket Description">
            The ticket's body. A ticket from the list fills it in. The Builder
            reads it with the acceptance criteria before it plans.
          </FieldHelp>
        }
      />

      <TextField
        label="Branch (optional)"
        inputId="input-branch"
        placeholder="auto-generated from the ticket ID"
        description="Created across every repository worktree. Leave it blank and X-Factory names it from the ticket ID and slug."
        value={draft.branch}
        onChange={setField("branch")}
      />

      <TextAreaField
        label="Acceptance criteria"
        inputId="input-criteria"
        rows={4}
        placeholder={
          "- Return 429 after 5 failed attempts\n- Reset counter after 15 minutes\n- Add unit tests for window expiration"
        }
        value={draft.criteria}
        onChange={setField("criteria")}
        labelAccessory={
          <FieldHelp field="Acceptance Criteria" title="Acceptance Criteria">
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
        value={draft.plan}
        onChange={setField("plan")}
        labelAccessory={
          <FieldHelp field="Implementation Plan" title="Implementation Plan">
            Step-by-step instructions or architectural guidance for the coding
            agent.
          </FieldHelp>
        }
      />

      {error && (
        <NewRunError
          message={error}
          needsRoles={needsRoles}
          onOpenSettings={onOpenSettings}
        />
      )}
    </form>
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
  const { draft, setField, error, setError, needsRoles, setNeedsRoles } =
    useNewRunDraft(isNewRunOpen, newRunPrefill);

  const submit = async () => {
    if (!targetProjectId) {
      setError("Please select a target project before starting a run.");
      return;
    }
    const missing = missingFieldMessage(draft);
    if (missing) {
      setError(missing);
      return;
    }

    setError(null);

    try {
      const run = await createRunMutation.mutateAsync(
        buildCreateRunInput(targetProjectId, draft),
      );

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
      setError(messageOf(err));
    }
  };

  // The footer's Start Run sits outside the form, so it calls submit directly.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  // The plan is optional: the Builder writes one when the form leaves it empty.
  const isSubmitDisabled =
    !draft.ticketId.trim() ||
    !draft.ticketTitle.trim() ||
    createRunMutation.isPending;

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
        <NewRunForm
          draft={draft}
          setField={setField}
          error={error}
          needsRoles={needsRoles}
          onSubmit={handleSubmit}
          onOpenSettings={closeNewRunModal}
        />
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
