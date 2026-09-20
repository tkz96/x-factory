// src/frontend/views/ProjectDetailView.tsx — Detailed single project view (XFM-48).

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
          <h3 style={{ marginTop: "1rem" }}>Loading Project…</h3>
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
            className="btn-secondary btn-sm"
            style={{ marginTop: "1rem" }}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
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
            <h2 id="project-detail-name" style={{ margin: 0 }}>
              {project.name}
            </h2>
            {project.archived && (
              <span
                className="role-badge"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Archived
              </span>
            )}
          </div>
        </div>

        <div
          id="project-detail-meta"
          className="project-detail-meta-grid"
          style={{ marginTop: "1.2rem" }}
        >
          <div className="project-meta-item">
            <strong>Project ID</strong>
            <code style={{ fontFamily: "var(--font-mono)" }}>{project.id}</code>
          </div>
          <div className="project-meta-item">
            <strong>Workspace Path</strong>
            <code style={{ fontFamily: "var(--font-mono)" }}>
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

        <div style={{ marginTop: "1.5rem" }}>
          <TrackerSection project={project} />
        </div>

        <div className="project-repos-section" style={{ marginTop: "1.5rem" }}>
          <div
            className="section-header-flex"
            style={{ marginBottom: "0.8rem" }}
          >
            <h3>Repositories</h3>
            <span
              id="project-detail-repo-count"
              className="nav-badge"
              style={{
                display: "inline-block",
                fontFamily: "var(--font-mono)",
              }}
            >
              {repos.length}
            </span>
          </div>

          <div
            id="project-detail-repos-table"
            className="repos-table-container card"
          >
            {repos.length === 0 ? (
              <p className="text-muted" style={{ padding: "1rem", margin: 0 }}>
                No separate sub-repositories configured. Using primary workspace
                repository.
              </p>
            ) : (
              <table
                className="table"
                style={{ width: "100%", borderCollapse: "collapse" }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <th style={{ padding: "0.6rem" }}>Repository Name</th>
                    <th style={{ padding: "0.6rem" }}>Path</th>
                    <th style={{ padding: "0.6rem" }}>Default Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.map((r) => (
                    <tr
                      key={r.name}
                      style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    >
                      <td style={{ padding: "0.6rem", fontWeight: 600 }}>
                        {r.name}
                      </td>
                      <td
                        style={{
                          padding: "0.6rem",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.85rem",
                        }}
                      >
                        {r.path}
                      </td>
                      <td style={{ padding: "0.6rem" }}>
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
