// src/frontend/lib/ticket-runs.ts — Which run, if any, a ticket already has
// (#260, spec #241). A ticket with an active run links to it; a ticket whose
// runs have all finished starts a new one; otherwise the first run starts.

import { ACTIVE_RUN_STATUSES } from "../../shared/run-status-policy.js";
import type { Run } from "../../shared/types.js";

export type TicketRunLink =
  | { kind: "active"; runId: string }
  | { kind: "finished" }
  | { kind: "none" };

/** The run state of one ticket, matched by project and ticket id. */
export function ticketRunLinkOf(
  runs: readonly Run[],
  projectId: string,
  ticketId: string,
): TicketRunLink {
  const own = runs.filter(
    (run) => run.project?.id === projectId && run.ticket?.id === ticketId,
  );
  if (own.length === 0) return { kind: "none" };

  // The most recently updated active run is the one to open.
  const active = own
    .filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const [first] = active;
  if (first) return { kind: "active", runId: first.id };
  return { kind: "finished" };
}
