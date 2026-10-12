// src/frontend/views/ProjectsView.tsx — The Projects list (#267, spec #241).
//
// The list route of the Projects split: the list, and a detail pane saying what
// a selection shows. Choosing a project routes to that project's own URL, so
// the browser's Back button retraces the projects the user opened (#258 kept
// the route; this ticket gives it the Mail-like two-pane shape).

import { ProjectsSplit } from "../components/projects/ProjectsSplit.js";

export function ProjectsView() {
  return <ProjectsSplit />;
}
