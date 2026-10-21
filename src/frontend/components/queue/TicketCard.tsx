// src/frontend/components/queue/TicketCard.tsx — A ticket in the Tickets list
// (XFM-47, #260). Its action follows the ticket's run: Open Run when a run is
// active, Start Run otherwise — one label, always those two words — and it
// is a row accessory, never the region's filled button.

import "./TicketCard.css";

import { Link, useNavigate } from "react-router-dom";
import type { Ticket } from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import type { TicketRunLink } from "../../lib/ticket-runs.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";

interface TicketCardProps {
  ticket: Ticket;
  /** The project the ticket belongs to: its run starts there (#260). */
  projectId: string;
  runLink: TicketRunLink;
  /**
   * The tracker's workflow label. A ticket that carries its own labels shows
   * those; a provider that maps none falls back to the label the tracker
   * requires, never a hard-coded one.
   */
  workflowLabel: string;
  /** Written by hand: a run exists for it, but the tracker does not list it. */
  handWritten?: boolean;
}

export function TicketCard({
  ticket,
  projectId,
  runLink,
  workflowLabel,
  handWritten = false,
}: TicketCardProps) {
  const { openNewRunModal } = useModal();
  const navigate = useNavigate();
  const activeRunId = runLink.kind === "active" ? runLink.runId : null;

  const handleSelect = () => {
    if (activeRunId) {
      navigate(`/runs/${activeRunId}`);
      return;
    }
    openNewRunModal({
      projectId,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      criteria: ticket.acceptanceCriteria,
    });
  };

  const criteriaPreview = (ticket.acceptanceCriteria || []).slice(0, 3);
  // The ticket's own labels, or the label the tracker requires when the
  // provider maps none. A tag, never a control: the Badge block's quiet role.
  const labels = handWritten
    ? ["Written by hand"]
    : ticket.labels && ticket.labels.length > 0
      ? ticket.labels
      : workflowLabel
        ? [workflowLabel]
        : [];

  return (
    // biome-ignore lint/a11y/useSemanticElements: Composite card contains nested action buttons
    <div
      className="ticket-card"
      data-list-row
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Select ticket ${ticket.id}: ${ticket.title}`}
    >
      <div className="ticket-card-header">
        <Badge variant="id" className="ticket-key">
          {ticket.id}
        </Badge>
        {activeRunId ? (
          <Link
            to={`/runs/${activeRunId}`}
            className="ui-button ui-button--secondary ui-button--sm btn-start-ticket"
            data-id={ticket.id}
            onClick={(e) => e.stopPropagation()}
          >
            Open Run
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="btn-start-ticket"
            data-id={ticket.id}
            onPress={handleSelect}
            // The card around it is a press target too (#260): the button's own
            // click must not reach it, or the run would open twice.
            onClick={(event) => event.stopPropagation()}
          >
            Start Run
          </Button>
        )}
      </div>

      <h3 className="ticket-title">{ticket.title}</h3>

      {criteriaPreview.length > 0 && (
        <ul className="ticket-criteria">
          {criteriaPreview.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      )}

      <div className="ticket-footer">
        <div className="ticket-tags">
          {labels.slice(0, 3).map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </div>
        {ticket.url && (
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ticket-ext-link"
            onClick={(e) => e.stopPropagation()}
          >
            View on {ticket.provider || "tracker"} ↗
          </a>
        )}
      </div>
    </div>
  );
}
