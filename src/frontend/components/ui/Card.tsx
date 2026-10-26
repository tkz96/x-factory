// src/frontend/components/ui/Card.tsx — The card block (#296, spec #292).
//
// Presentational: one surface block whose seven variants cover the card
// families the migration replaces — default (.card), connection
// (.connection-card), ticket (.ticket-card), model (.model-connection-card),
// review (.review-summary-card), chat (.run-chat-card) and flow
// (.flow-fallback-card). Diagram node cards are graph content and keep their
// own style; every other card composes this block and never names a class of
// its own.
//
// The look comes from the block: hairline, radius and surface tokens in the
// shared layer (styles/shared/controls.css). A card sets no type — the words
// inside it use the text styles (DESIGN.md §7) — and never reaches for the
// glass material: content stays opaque, chrome alone is glass (spec #292,
// "Materials and Reduce Transparency").
//
// <Card variant="ticket" onClick={select}> … </Card>
//
// The pressable family (`variant="ticket"`) carries the hover affordance only;
// the screen wires the behaviour (role, press), exactly as TicketCard does
// today, until the decision-card pattern lands.

import type { ReactNode } from "react";

/** The card families spec #292 replaces, one variant per family. */
export type CardVariant =
  | "default"
  | "connection"
  | "ticket"
  | "model"
  | "review"
  | "chat"
  | "flow";

export interface CardProps {
  /** Which card family the block stands in for (DESIGN.md §7 "Cards"). */
  variant?: CardVariant;
  /** Layout only — the look comes from the block. */
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Card({
  variant = "default",
  id,
  className,
  children,
}: CardProps) {
  const classes = ["ui-card", `ui-card--${variant}`];
  if (className !== undefined) classes.push(className);
  return (
    <div {...(id ? { id } : {})} className={classes.join(" ")}>
      {children}
    </div>
  );
}
