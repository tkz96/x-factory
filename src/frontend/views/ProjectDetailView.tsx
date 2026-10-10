// src/frontend/views/ProjectDetailView.tsx — Detailed single project view
// (XFM-48; rebuilt on the feedback family in #147).
//
// The read region (loading / error / not-found) renders through AsyncRegion and
// the copy map; the project header carries the persisted git host + tracker
// combo line (spec #133 story 48) and the tracker card below it carries the
// integrity failure when the project has no tracker.

import "./ProjectDetailView.css";

import { useNavigate, useParams } from "react-router-dom";
import { ConnectionComboLine } from "../components/connections/ConnectionComboLine.js";
import { comboTone } from "../components/connections/connection-state.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { PROJECT_DETAIL_COPY } from "../components/feedback/copy-map.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import {
  comboSlots,
  deriveConnectionIntegrity,
  REQUIRED_POST_CREATION_ROLES,
  recordedConnectionIdentityTargets,
} from "../components/projects/connection-integrity.js";
import { ReadinessBanner } from "../components/projects/ReadinessBanner.js";
import { TrackerSection } from "../components/projects/TrackerSection.js";
import { useConnectionLine } from "../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useProjects } from "../hooks/useQueries.js";

export function ProjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectsQuery = useProjects();
  const { data: descriptors = [] } = useProviderDescriptors();

  const projects = projectsQuery.data ?? [];
  const project = projects.find((p) => p.id === id);

  // One read region over the projects query: loading until it resolves, a
  // retryable error if it fails, and the not-found empty state once the
  // catalog has loaded without this id.
  const derived = deriveAsyncState(projectsQuery, {
    isEmpty: () => projectsQuery.data !== undefined && project === undefined,
  });

  const backToProjects = () => navigate("/projects");

  // The identity wiring for the project this view resolved — no slots while the
  // read has not resolved to one. It happens BEFORE the not-found return because
  // it is a hook: hooks run in the same order on every render (#133 story 34),
  // and the derived integrity is pure, so computing it here for the line the
  // render below may not reach costs nothing.
  const integrity =
    project === undefined
      ? undefined
      : deriveConnectionIntegrity(project, descriptors);
  const slots = useConnectionLine(
    integrity === undefined ? [] : comboSlots(integrity),
    integrity === undefined
      ? []
      : recordedConnectionIdentityTargets(integrity, undefined, descriptors),
  );

  if (project === undefined || integrity === undefined) {
    return (
      <section id="area-projects" className="area-view active">
        <AsyncRegion
          derived={derived}
          onRetry={() => void projectsQuery.refetch()}
          emptyCopy={PROJECT_DETAIL_COPY.notFound(id ?? "")}
          emptyAction={
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={backToProjects}
            >
              ← {PROJECT_DETAIL_COPY.backToProjects}
            </button>
          }
        />
      </section>
    );
  }

  const repos = project.repositories || [];

  return (
    <section id="area-projects" className="area-view active">
      <div id="projects-detail-view" className="view-panel">
        <div className="section-header-flex">
          <div className="flex-center gap-3">
            <button
              type="button"
              id="btn-back-to-projects-list"
              className="btn-secondary btn-sm"
              title={PROJECT_DETAIL_COPY.backToProjectsTitle}
              aria-label={PROJECT_DETAIL_COPY.backToProjectsTitle}
              onClick={backToProjects}
            >
              <svg className="icon icon-sm" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-arrow-left" />
              </svg>
              <span>{PROJECT_DETAIL_COPY.allProjects}</span>
            </button>
            <h2 id="project-detail-name">{project.name}</h2>
            {project.archived && (
              <span className="role-badge role-badge-archived">
                {PROJECT_DETAIL_COPY.archived}
              </span>
            )}
          </div>
        </div>

        <ConnectionComboLine
          id="project-connections-combo"
          slots={slots}
          tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
          descriptors={descriptors}
        />

        <div id="project-detail-meta" className="project-detail-meta-grid mt-4">
          <div className="project-meta-item">
            <strong>{PROJECT_DETAIL_COPY.projectId}</strong>
            <code>{project.id}</code>
          </div>
          <div className="project-meta-item">
            <strong>{PROJECT_DETAIL_COPY.workspacePath}</strong>
            <code>
              {project.workspacePath ||
                project.repositoryPath ||
                PROJECT_DETAIL_COPY.defaultWorkspace}
            </code>
          </div>
          <div className="project-meta-item">
            <strong>{PROJECT_DETAIL_COPY.defaultBranch}</strong>
            <span>
              {project.defaultBranch ||
                PROJECT_DETAIL_COPY.defaultBranchFallback}
            </span>
          </div>
          <div className="project-meta-item">
            <strong>{PROJECT_DETAIL_COPY.repositories}</strong>
            <span>
              {PROJECT_DETAIL_COPY.repositoriesConnected(repos.length)}
            </span>
          </div>
        </div>

        <ReadinessBanner />

        <div className="mt-6">
          <TrackerSection project={project} />
        </div>

        <div className="project-repos-section mt-6">
          <div className="section-header-flex mb-3">
            <h3>{PROJECT_DETAIL_COPY.repositories}</h3>
            <span id="project-detail-repo-count" className="nav-badge">
              {repos.length}
            </span>
          </div>

          <div
            id="project-detail-repos-table"
            className="repos-table-container card"
          >
            {repos.length === 0 ? (
              <p className="text-muted p-4">
                {PROJECT_DETAIL_COPY.repositoriesEmpty}
              </p>
            ) : (
              <table className="repos-table">
                <thead>
                  <tr>
                    <th>{PROJECT_DETAIL_COPY.repositoryNameColumn}</th>
                    <th>{PROJECT_DETAIL_COPY.repositoryPathColumn}</th>
                    <th>{PROJECT_DETAIL_COPY.repositoryBranchColumn}</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.map((r) => (
                    <tr key={r.name}>
                      <td className="cell-name">{r.name}</td>
                      <td className="cell-truncate">{r.path}</td>
                      <td className="cell-branch">
                        {r.defaultBranch ||
                          PROJECT_DETAIL_COPY.defaultBranchFallback}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
