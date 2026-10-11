// src/frontend/components/projects/ProjectScopePicker.tsx — The toolbar project
// picker that scopes Tickets and Runs alike (#260, spec #241).

import { useCurrentProject } from "../../context/ProjectContext.js";
import { ALL_PROJECTS } from "../../lib/project-scope.js";

/** A native select: the toolbar's one place to choose the shared scope. */
export function ProjectScopePicker() {
  const { projects, isProjectsLoading, scope, setSelectedProjectId } =
    useCurrentProject();

  if (projects.length === 0) return null;

  return (
    <select
      id="select-project"
      className="toolbar-select"
      aria-label="Project"
      value={scope}
      onChange={(e) => setSelectedProjectId(e.target.value)}
      disabled={isProjectsLoading}
    >
      <option value={ALL_PROJECTS}>All Projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
