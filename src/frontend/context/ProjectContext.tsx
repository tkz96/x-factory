// src/frontend/context/ProjectContext.tsx — The shared project scope (XFM-46,
// #260). Tickets and Runs both follow it: a project id, or ALL_PROJECTS.

import { createContext, type ReactNode, useContext, useState } from "react";
import type { Project } from "../../shared/types.js";
import { useProjects } from "../hooks/useQueries.js";
import {
  ALL_PROJECTS,
  readStoredProjectScope,
  resolveProjectScope,
  writeStoredProjectScope,
} from "../lib/project-scope.js";

interface ProjectContextValue {
  projects: Project[];
  isProjectsLoading: boolean;
  /** ALL_PROJECTS, or the id of the project the scope names. */
  scope: string;
  isAllProjects: boolean;
  /**
   * The project a single action applies to: the scoped project, or the first
   * active one when the scope is All Projects. "" when there are no projects.
   */
  selectedProjectId: string;
  selectedProject: Project | undefined;
  /** Sets the shared scope (a project id or ALL_PROJECTS) and remembers it. */
  setSelectedProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data, isLoading: isProjectsLoading } = useProjects();
  const projects = data ?? [];
  const [storedScope, setStoredScope] = useState<string>(
    readStoredProjectScope,
  );
  const scope = resolveProjectScope(storedScope, projects, data !== undefined);
  const isAllProjects = scope === ALL_PROJECTS;

  const firstActive = projects.find((p) => !p.archived) ?? projects[0];
  const scopedProject = isAllProjects
    ? undefined
    : projects.find((p) => p.id === scope);
  const selectedProject = scopedProject ?? firstActive;
  // A scoped project is acted on by its id even before the project list has
  // loaded, so a remembered choice is never lost to a slow first request.
  const selectedProjectId = isAllProjects ? (firstActive?.id ?? "") : scope;

  const setSelectedProjectId = (id: string) => {
    setStoredScope(id);
    writeStoredProjectScope(id);
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isProjectsLoading,
        scope,
        isAllProjects,
        selectedProjectId,
        selectedProject,
        setSelectedProjectId,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useCurrentProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useCurrentProject must be used within a ProjectProvider");
  }
  return ctx;
}
