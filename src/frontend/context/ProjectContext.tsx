// src/frontend/context/ProjectContext.tsx — Global project selection context (XFM-46).

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Project } from "../../shared/types.js";
import { useProjects } from "../hooks/useQueries.js";

interface ProjectContextValue {
  projects: Project[];
  isProjectsLoading: boolean;
  selectedProjectId: string;
  selectedProject: Project | undefined;
  setSelectedProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [], isLoading: isProjectsLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(
    () => {
      if (typeof window !== "undefined") {
        return localStorage.getItem("xf_selected_project") || "";
      }
      return "";
    },
  );

  useEffect(() => {
    if (projects.length > 0) {
      // If current selectedProjectId is not valid or empty, select the first active project
      const exists = projects.some((p) => p.id === selectedProjectId);
      if (!exists || !selectedProjectId) {
        const firstActive = projects.find((p) => !p.archived) || projects[0];
        if (firstActive) {
          setSelectedProjectIdState(firstActive.id);
          localStorage.setItem("xf_selected_project", firstActive.id);
        }
      }
    }
  }, [projects, selectedProjectId]);

  const setSelectedProjectId = (id: string) => {
    setSelectedProjectIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("xf_selected_project", id);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isProjectsLoading,
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
