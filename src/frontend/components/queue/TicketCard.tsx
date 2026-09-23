// src/frontend/components/queue/TicketCard.tsx — Ticket card component with prefill action (XFM-47).

import "./TicketCard.css";

import type { Ticket } from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";

interface TicketCardProps {
  ticket: Ticket;
}

export function TicketCard({ ticket }: TicketCardProps) {
  const { openNewRunModal } = useModal();

  const handleSelect = () => {
    openNewRunModal({
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
        <button
          type="button"
          className="btn-primary btn-sm btn-start-ticket"
          data-id={ticket.id}
          onClick={(e) => {
            e.stopPropagation();
            handleSelect();
          }}
        >
          Start Run
        </button>
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
