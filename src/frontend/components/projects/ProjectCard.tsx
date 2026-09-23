// src/frontend/components/projects/ProjectCard.tsx — Project card component (XFM-48).

import "./ProjectCard.css";

import { Link } from "react-router-dom";
import type { Project } from "../../../shared/types.js";

interface ProjectCardProps {
  project: Project;
  isArchived?: boolean;
}

export function ProjectCard({ project, isArchived }: ProjectCardProps) {
  const repoCount = (project.repositories || []).length;
  const trackerLabel =
    project.issueTracker?.provider ||
    project.issueTracker?.connectionId ||
    "None";
  const displayPath =
    project.workspacePath || project.repositoryPath || "Configured";

  return (
    <Link
      to={`/projects/${project.id}`}
      className={`project-card card project-card-link ${
        isArchived ? "is-archived" : ""
      }`}
      aria-label={`View details for project ${project.name}`}
    >
      <div className="project-card-header">
        <h3 title={project.name}>{project.name}</h3>
        {isArchived ? (
          <span className="role-badge role-badge-archived">Archived</span>
        ) : (
          <span className="role-badge">{trackerLabel}</span>
        )}
      </div>

      <div className="project-card-meta">
        <strong>ID</strong>
        <code title={project.id}>{project.id}</code>
      </div>

      <div className="project-card-meta">
        <strong>Workspace</strong>
        <code title={displayPath}>{displayPath}</code>
      </div>

      {isArchived ? (
        <div className="project-card-meta">
          <strong>Tracker</strong>
          <span className="meta-val" title={`${trackerLabel} (Locked)`}>
            {trackerLabel} (Locked)
          </span>
        </div>
      ) : (
        <div className="project-card-footer">
          <span className="nav-badge">
            {repoCount} {repoCount === 1 ? "repo" : "repos"}
          </span>
          <span className="status-pill ready">View Details →</span>
        </div>
      )}
    </Link>
  );
}
