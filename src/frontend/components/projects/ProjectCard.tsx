// src/frontend/components/projects/ProjectCard.tsx — Project card component
// (XFM-48; connections combo added in #147).
//
// The card shows the project's git host + tracker combo line (spec #133 story
// 48) instead of a provider-conditional tracker badge, and renders the
// integrity failure with its repair path when the project has no tracker. The
// repair action sits outside the card's anchor: an interactive element nested
// inside a link is invalid HTML.

import "./ProjectCard.css";

import { Link, useNavigate } from "react-router-dom";
import type { Project } from "../../../shared/types.js";
import { useProviderDescriptors } from "../../hooks/useProviderDescriptors.js";
import { CONNECTIONS_COPY } from "../feedback/copy-map.js";
import { RetryAction } from "../feedback/RetryAction.js";
import { ConnectionComboLine } from "./ConnectionComboLine.js";
import { deriveConnectionIntegrity } from "./connection-integrity.js";

interface ProjectCardProps {
  project: Project;
  isArchived?: boolean;
}

export function ProjectCard({ project, isArchived }: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: descriptors = [] } = useProviderDescriptors();

  const repoCount = (project.repositories || []).length;
  const integrity = deriveConnectionIntegrity(project, descriptors);
  const displayPath =
    project.workspacePath || project.repositoryPath || "Configured";

  return (
    <div className={`project-card card ${isArchived ? "is-archived" : ""}`}>
      <Link
        to={`/projects/${project.id}`}
        className="project-card-link"
        aria-label={`View details for project ${project.name}`}
      >
        <div className="project-card-header">
          <h3 title={project.name}>{project.name}</h3>
          {isArchived && (
            <span className="role-badge role-badge-archived">Archived</span>
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

        <ConnectionComboLine
          integrity={integrity}
          descriptors={descriptors}
          className="connection-combo-line--compact"
        />

        {!isArchived && (
          <div className="project-card-footer">
            <span className="nav-badge">
              {repoCount} {repoCount === 1 ? "repo" : "repos"}
            </span>
            <span className="status-pill ready">View Details →</span>
          </div>
        )}
      </Link>

      {integrity.hasIntegrityFailure && (
        <div className="project-card-repair">
          <RetryAction
            label={CONNECTIONS_COPY.reconnect}
            onRetry={() => navigate("/settings")}
          />
        </div>
      )}
    </div>
  );
}
