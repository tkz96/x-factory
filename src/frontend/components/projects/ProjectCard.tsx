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
import { useConnectionIdentities } from "../../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../../hooks/useProviderDescriptors.js";
import { ConnectionComboLine } from "../connections/ConnectionComboLine.js";
import {
  comboTone,
  identitiesByRole,
  withConnectionIdentities,
} from "../connections/connection-state.js";
import {
  CONNECTIONS_COPY,
  PROJECT_CARD_COPY,
  PROJECT_DETAIL_COPY,
} from "../feedback/copy-map.js";
import { RetryAction } from "../feedback/RetryAction.js";
import {
  comboSlots,
  connectionIdentityTargets,
  deriveConnectionIntegrity,
  REQUIRED_CONNECTION_ROLES,
} from "./connection-integrity.js";

interface ProjectCardProps {
  project: Project;
  isArchived?: boolean;
}

export function ProjectCard({ project, isArchived }: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: descriptors = [] } = useProviderDescriptors();

  const repoCount = (project.repositories || []).length;
  const integrity = deriveConnectionIntegrity(project, descriptors);
  // The provider's own identity for each connection (#133 story 34).
  const identityTargets = connectionIdentityTargets(integrity);
  const identityLookup = useConnectionIdentities(identityTargets);
  const slots = withConnectionIdentities(
    comboSlots(integrity),
    identitiesByRole(identityTargets, identityLookup),
  );
  const displayPath =
    project.workspacePath ||
    project.repositoryPath ||
    PROJECT_CARD_COPY.workspaceFallback;

  return (
    <div className={`project-card card ${isArchived ? "is-archived" : ""}`}>
      <Link
        to={`/projects/${project.id}`}
        className="project-card-link"
        aria-label={PROJECT_CARD_COPY.viewDetailsLabel(project.name)}
      >
        <div className="project-card-header">
          <h3 title={project.name}>{project.name}</h3>
          {isArchived && (
            <span className="role-badge role-badge-archived">
              {PROJECT_DETAIL_COPY.archived}
            </span>
          )}
        </div>

        <div className="project-card-meta">
          <strong>{PROJECT_CARD_COPY.id}</strong>
          <code title={project.id}>{project.id}</code>
        </div>

        <div className="project-card-meta">
          <strong>{PROJECT_CARD_COPY.workspace}</strong>
          <code title={displayPath}>{displayPath}</code>
        </div>

        <ConnectionComboLine
          slots={slots}
          tone={comboTone(slots, REQUIRED_CONNECTION_ROLES)}
          descriptors={descriptors}
          className="connection-combo-line--compact"
        />

        {!isArchived && (
          <div className="project-card-footer">
            <span className="nav-badge">
              {PROJECT_CARD_COPY.repositoryCount(repoCount)}
            </span>
            <span className="status-pill ready">
              {PROJECT_CARD_COPY.viewDetails}
            </span>
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
