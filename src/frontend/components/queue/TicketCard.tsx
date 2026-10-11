// src/frontend/components/queue/TicketCard.tsx — A ticket in the Tickets list
// (XFM-47, #260). Its action follows the ticket's run: Open Run when a run is
// active, Start New Run when every run has finished, Start Run otherwise.

import "./TicketCard.css";

import { Link, useNavigate } from "react-router-dom";
import type { Ticket } from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import type { TicketRunLink } from "../../lib/ticket-runs.js";

interface TicketCardProps {
  ticket: Ticket;
  /** The project the ticket belongs to: its run starts there (#260). */
  projectId: string;
  runLink: TicketRunLink;
}

export function TicketCard({ ticket, projectId, runLink }: TicketCardProps) {
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
      plan: `1. Understand ticket requirements\n2. Implement changes for ${ticket.title}\n3. Verify test suite passes without regressions\n4. Review and deliver`,
    });
  };

  const criteriaPreview = (ticket.acceptanceCriteria || []).slice(0, 3);

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
        <div className="ticket-badges">
          <span className="ticket-key">{ticket.id}</span>
          {ticket.provider && (
            <span className="ticket-provider">{ticket.provider}</span>
          )}
        </div>
        {activeRunId ? (
          <Link
            to={`/runs/${activeRunId}`}
            className="btn-secondary btn-sm btn-start-ticket"
            data-id={ticket.id}
            onClick={(e) => e.stopPropagation()}
          >
            Open Run
          </Link>
        ) : (
          <button
            type="button"
            className="btn-primary btn-sm btn-start-ticket"
            data-id={ticket.id}
            onClick={(e) => {
              e.stopPropagation();
              handleSelect();
            }}
          >
            {runLink.kind === "finished" ? "Start New Run" : "Start Run"}
          </button>
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
          <span className="filter-pill ticket-pill">
            <span className="pill-dot" />
            agentic-workflow
          </span>
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
