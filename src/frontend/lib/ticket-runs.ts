// src/frontend/lib/ticket-runs.ts — Which run, if any, a ticket already has
// (#260, spec #241). A ticket with an active run links to it; a ticket whose
// runs have all finished starts a new one; otherwise the first run starts.

import { ACTIVE_RUN_STATUSES } from "../../shared/run-status-policy.js";
import type { Run, Ticket } from "../../shared/types.js";

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

/**
 * The ticket id a run stores for a tracker id. The server replaces every
 * character outside letters, digits, `.`, `_` and `-` with `-` (createRun),
 * so a tracker id such as `AB#1234` is stored as `AB-1234`.
 */
function storedTicketId(ticketId: string): string {
  return ticketId.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * The tickets a project's runs were started for that its tracker does not
 * list: the tickets written by hand. Read from the runs only, so nothing is
 * stored. A ticket with several runs appears once, with the title and criteria
 * of its most recently updated run.
 */
export function handWrittenTicketsOf(
  runs: readonly Run[],
  projectId: string,
  trackerTickets: readonly Ticket[],
): Ticket[] {
  const tracked = new Set(trackerTickets.map((t) => storedTicketId(t.id)));
  const latest = new Map<string, Run>();
  for (const run of runs) {
    if (run.project?.id !== projectId || !run.ticket?.id) continue;
    if (tracked.has(run.ticket.id)) continue;
    const seen = latest.get(run.ticket.id);
    if (!seen || Date.parse(run.updatedAt) > Date.parse(seen.updatedAt)) {
      latest.set(run.ticket.id, run);
    }
  }
  return [...latest.values()].map((run) => ({
    id: run.ticket.id,
    title: run.ticket.title,
    acceptanceCriteria: run.ticket.acceptanceCriteria ?? [],
  }));
}
