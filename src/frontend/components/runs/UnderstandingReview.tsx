// src/frontend/components/runs/UnderstandingReview.tsx — What the understand stage produced, shown on the
// understanding checkpoint. The verdict and the criteria the operator must decide come first, then the
// risks, then the rest of the understanding, then the ticket it was drawn from. Each list is the shared grouped list, so it reads like the
// rest of the app.

import "./UnderstandingReview.css";

import type { ImplementationContext, Ticket } from "../../../shared/types.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";
import {
  RunTicket,
  TitleOnlyWarning,
  ticketHasOnlyTitle,
} from "./RunTicket.js";

export interface UnderstandingReviewProps {
  context: ImplementationContext;
  /** The ticket as the run received it: what the understanding was drawn from. */
  ticket: Ticket;
}

export function UnderstandingReview({
  context,
  ticket,
}: UnderstandingReviewProps) {
  const conflicts = context.conflicts ?? [];

  return (
    <section
      className="understanding-review"
      aria-label="What the Builder understood"
    >
      <TitleOnlyWarning ticket={ticket} />
      {context.changeRequired === false && (
        <div className="understanding-review-verdict">
          <p className="understanding-review-verdict-title text-headline">
            The understanding found that no change is required
          </p>
          {context.changeReason && (
            <p className="understanding-review-verdict-reason text-callout">
              {context.changeReason}
            </p>
          )}
        </div>
      )}
      {conflicts.length > 0 && (
        <ListGroup
          title="Needs your decision"
          footer="Settle these before you approve. Request Changes and say how each criterion should read."
        >
          {conflicts.map((conflict) => (
            <ListGroupRow key={conflict} title={conflict} />
          ))}
        </ListGroup>
      )}
      {context.risks.length > 0 && (
        <ListGroup title="Risks">
          {context.risks.map((risk) => (
            <ListGroupRow key={risk} title={risk} />
          ))}
        </ListGroup>
      )}
      {context.relevantFiles.length > 0 && (
        <ListGroup title="Relevant files">
          {context.relevantFiles.map((file) => (
            <ListGroupRow key={file} title={file} />
          ))}
        </ListGroup>
      )}
      {context.existingBehavior && (
        <ListGroup title="Existing behavior">
          <ListGroupRow title={context.existingBehavior} />
        </ListGroup>
      )}
      {context.constraints.length > 0 && (
        <ListGroup title="Constraints">
          {context.constraints.map((constraint) => (
            <ListGroupRow key={constraint} title={constraint} />
          ))}
        </ListGroup>
      )}
      {context.architecturalNotes && (
        <ListGroup title="Architectural notes">
          <ListGroupRow title={context.architecturalNotes} />
        </ListGroup>
      )}
      {/* A title-only ticket has nothing more to show; the warning above says so. */}
      {!ticketHasOnlyTitle(ticket) && (
        <section
          className="understanding-review-ticket"
          aria-labelledby="understanding-review-ticket"
        >
          <h3
            id="understanding-review-ticket"
            className="understanding-review-caption text-footnote font-semibold"
          >
            The ticket it read
          </h3>
          <RunTicket ticket={ticket} idPrefix="understanding-review-ticket" />
        </section>
      )}
    </section>
  );
}
