// src/frontend/views/ProjectsView.tsx — Projects catalog view with active & archived tabs (XFM-38, XFM-40, XFM-48).

import { useState } from "react";
import { EmptyStateCard } from "../components/EmptyStateCard.js";
import { ProjectCard } from "../components/projects/ProjectCard.js";
import { useModal } from "../context/ModalContext.js";
import { useProjects } from "../hooks/useQueries.js";

export function ProjectsView() {
  const { data: projects = [], isLoading, error } = useProjects();
  const { openOnboardingModal } = useModal();
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => Boolean(p.archived));

  return (
    <section id="area-projects" className="area-view active">
      <div id="projects-list-view" className="view-panel">
        <div className="section-header-flex">
          <div>
            <h2>Configured Projects</h2>
            <p className="text-muted">
              Software products and multi-repository workspaces connected to
              X-Factory.
            </p>
          </div>
          <button
            type="button"
            id="btn-open-onboard-modal"
            className="btn-primary"
            onClick={openOnboardingModal}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-plus" />
            </svg>
            <span>Onboard Project</span>
          </button>
        </div>

        {/* Switchable Tabs: Active / Archived */}
        <div className="projects-tab-bar">
          <div
            className="projects-segmented-control"
            role="tablist"
            aria-label="Projects Views"
          >
            <button
              type="button"
              className={`projects-tab-btn ${activeTab === "active" ? "active" : ""}`}
              id="btn-tab-active-projects"
              role="tab"
              aria-selected={activeTab === "active"}
              onClick={() => setActiveTab("active")}
            >
              <span>Active Projects</span>
              <span id="active-projects-count" className="projects-tab-badge">
                {activeProjects.length}
              </span>
            </button>
            <button
              type="button"
              className={`projects-tab-btn ${activeTab === "archived" ? "active" : ""}`}
              id="btn-toggle-archived"
              role="tab"
              aria-selected={activeTab === "archived"}
              onClick={() => setActiveTab("archived")}
            >
              <span>Archived Projects</span>
              <span id="archived-projects-count" className="projects-tab-badge">
                {archivedProjects.length}
              </span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <EmptyStateCard type="loading" title="Loading Projects…" />
        ) : error ? (
          <EmptyStateCard
            type="error"
            title="Unable to Load Projects"
            message={String(error)}
          />
        ) : activeTab === "active" ? (
          <div id="projects-container" className="projects-grid">
            {activeProjects.length === 0 ? (
              <EmptyStateCard
                icon="icon-folder"
                title="No Active Projects"
                message="Click Onboard Project to connect a workspace repository."
                actionText="Onboard Project"
                onAction={openOnboardingModal}
                className="col-span-full"
              />
            ) : (
              activeProjects.map((p) => <ProjectCard key={p.id} project={p} />)
            )}
          </div>
        ) : (
          <div id="archived-projects-section">
            <div id="archived-projects-container" className="projects-grid">
              {archivedProjects.length === 0 ? (
                <EmptyStateCard
                  message="No archived projects found."
                  className="col-span-full"
                />
              ) : (
                archivedProjects.map((p) => (
                  <ProjectCard key={p.id} project={p} isArchived />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
