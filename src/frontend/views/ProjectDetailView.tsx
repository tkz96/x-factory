// src/frontend/views/ProjectDetailView.tsx — Detailed single project view
// (XFM-48; rebuilt on the feedback family in #147).
//
// The read region (loading / error / not-found) renders through AsyncRegion and
// the copy map; the project header carries the persisted git host + tracker
// combo line (spec #133 story 48) and the tracker card below it carries the
// integrity failure when the project has no tracker.

import "./ProjectDetailView.css";

import { useNavigate, useParams } from "react-router-dom";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { PROJECT_DETAIL_COPY } from "../components/feedback/copy-map.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { ConnectionComboLine } from "../components/projects/ConnectionComboLine.js";
import { deriveConnectionIntegrity } from "../components/projects/connection-integrity.js";
import { ReadinessBanner } from "../components/projects/ReadinessBanner.js";
import { TrackerSection } from "../components/projects/TrackerSection.js";
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

  if (project === undefined) {
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
  const integrity = deriveConnectionIntegrity(project, descriptors);

  return (
    <section id="area-projects" className="area-view active">
      <div id="projects-detail-view" className="view-panel">
        <div className="section-header-flex">
          <div className="flex-center gap-3">
            <button
              type="button"
              id="btn-back-to-projects-list"
              className="btn-secondary btn-sm"
              title="Back to all projects"
              aria-label="Back to all projects"
              onClick={backToProjects}
            >
              <svg className="icon icon-sm" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-arrow-left" />
              </svg>
              <span>All Projects</span>
            </button>
            <h2 id="project-detail-name">{project.name}</h2>
            {project.archived && (
              <span className="role-badge role-badge-archived">Archived</span>
            )}
          </div>
        </div>

        <ConnectionComboLine
          id="project-connections-combo"
          integrity={integrity}
          descriptors={descriptors}
        />

        <div id="project-detail-meta" className="project-detail-meta-grid mt-4">
          <div className="project-meta-item">
            <strong>Project ID</strong>
            <code>{project.id}</code>
          </div>
          <div className="project-meta-item">
            <strong>Workspace Path</strong>
            <code>
              {project.workspacePath || project.repositoryPath || "Default"}
            </code>
          </div>
          <div className="project-meta-item">
            <strong>Default Branch</strong>
            <span>{project.defaultBranch || "main"}</span>
          </div>
          <div className="project-meta-item">
            <strong>Repositories</strong>
            <span>{repos.length} connected</span>
          </div>
        </div>

        <ReadinessBanner />

        <div className="mt-6">
          <TrackerSection project={project} />
        </div>

        <div className="project-repos-section mt-6">
          <div className="section-header-flex mb-3">
            <h3>Repositories</h3>
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
                No separate sub-repositories configured. Using primary workspace
                repository.
              </p>
            ) : (
              <table className="repos-table">
                <thead>
                  <tr>
                    <th>Repository Name</th>
                    <th>Path</th>
                    <th>Default Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.map((r) => (
                    <tr key={r.name}>
                      <td className="cell-name">{r.name}</td>
                      <td className="cell-truncate">{r.path}</td>
                      <td className="cell-branch">
                        {r.defaultBranch || "main"}
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
