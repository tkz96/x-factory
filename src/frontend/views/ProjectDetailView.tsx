// src/frontend/views/ProjectDetailView.tsx — Detailed single project view (XFM-48).

import "./ProjectDetailView.css";

import { useNavigate, useParams } from "react-router-dom";
import { ReadinessBanner } from "../components/projects/ReadinessBanner.js";
import { TrackerSection } from "../components/projects/TrackerSection.js";
import { useProjects } from "../hooks/useQueries.js";

export function ProjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();

  const project = projects.find((p) => p.id === id);

  if (isLoading) {
    return (
      <section id="area-projects" className="area-view active">
        <div className="empty-state card">
          <div className="spinner-sm" />
          <h3 className="mt-4">Loading Project…</h3>
        </div>
      </section>
    );
  }

  if (!project) {
    return (
      <section id="area-projects" className="area-view active">
        <div className="empty-state card">
          <div className="empty-icon">
            <svg className="icon icon-xl" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-alert-circle" />
            </svg>
          </div>
          <h3>Project Not Found</h3>
          <p className="text-muted">
            The project &ldquo;{id}&rdquo; does not exist or has been removed.
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm mt-4"
            onClick={() => navigate("/projects")}
          >
            ← Back to Projects
          </button>
        </div>
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
              title="Back to all projects"
              aria-label="Back to all projects"
              onClick={() => navigate("/projects")}
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

        <div id="project-detail-meta" className="project-detail-meta-grid">
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
