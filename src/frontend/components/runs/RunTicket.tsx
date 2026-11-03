// src/frontend/components/runs/RunTicket.tsx — The ticket exactly as the run received it: its
// description and acceptance criteria. The Builder reads this copy, never the tracker, so the
// reader sees what the run works from. A ticket with neither is a warning: the run has only its
// title, and everything it understands is a guess from that.

import "./RunTicket.css";

import type { Ticket } from "../../../shared/types.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";

const TITLE_ONLY_WARNING =
  "This run has only the ticket's title. The Builder works from the title alone, so what it understands is a guess. Stop the run and start it again with the ticket's description or acceptance criteria.";

/** True when the run received no description and no acceptance criteria. */
export function ticketHasOnlyTitle(ticket: Ticket): boolean {
  return (
    !ticket.description?.trim() &&
    ticket.acceptanceCriteria.every((criterion) => !criterion.trim())
  );
}

/** The warning for a run that has only its ticket's title; nothing otherwise. */
export function TitleOnlyWarning({ ticket }: { ticket: Ticket }) {
  if (!ticketHasOnlyTitle(ticket)) return null;
  return <FeedbackBanner tone="warning" message={TITLE_ONLY_WARNING} />;
}

interface RunTicketProps {
  ticket: Ticket;
  /** Prefixes the ids that tie each caption to its content. */
  idPrefix: string;
}

export function RunTicket({ ticket, idPrefix }: RunTicketProps) {
  const description = ticket.description?.trim() ?? "";
  const criteria = ticket.acceptanceCriteria.filter((c) => c.trim());
  const criteriaCaption = `${idPrefix}-criteria`;

  return (
    <div className="run-ticket">
      <TitleOnlyWarning ticket={ticket} />
      {description && (
        <p className="run-ticket-description text-callout">{description}</p>
      )}
      {criteria.length > 0 && (
        <div className="run-ticket-criteria">
          <p id={criteriaCaption} className="run-ticket-caption text-footnote">
            Acceptance criteria
          </p>
          <ul
            className="run-ticket-criteria-list text-callout"
            aria-labelledby={criteriaCaption}
          >
            {criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
