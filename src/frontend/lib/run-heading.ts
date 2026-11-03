// src/frontend/lib/run-heading.ts — The one place that names a run for a page heading: ticket id
// and title, then project and branch. A missing part is left out, never invented or printed as
// "undefined".

import type { Run } from "../../shared/types.js";

/** "GH-3 — Fix it"; just the id when the ticket has no title. */
export function runHeadingTitle(run: Run): string {
  const id = run.ticket?.id || run.id;
  const title = run.ticket?.title?.trim();
  return title ? `${id} — ${title}` : id;
}

/** "Project · branch", leaving out whichever the run does not have. */
export function runHeadingSubtitle(run: Run): string {
  return [run.project?.name, run.branch]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
