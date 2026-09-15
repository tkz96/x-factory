// public/js/views/projects.ts — Configured Projects area static template.

import { createViewFromTemplate } from "./template-helper.js";

const PROJECTS_TEMPLATE = `
<section id="area-projects" class="area-view">
  <!-- Projects List Sub-view -->
  <div id="projects-list-view" class="card">
    <div class="section-header-flex">
      <div>
        <h2>Configured Projects</h2>
        <p class="text-muted">Software products and multi-repository workspaces connected to X-Factory.</p>
      </div>
      <button id="btn-open-onboard-modal" class="btn-primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>Onboard Project</span>
      </button>
    </div>
    <div id="projects-container" class="projects-grid">
      <!-- Projects rendered here -->
    </div>
  </div>

  <!-- Project Detail Sub-view (hidden by default) -->
  <div id="projects-detail-view" class="card" hidden>
    <div class="section-header-flex">
      <div style="display: flex; align-items: center; gap: 0.8rem;">
        <button id="btn-back-to-projects-list" class="btn-secondary btn-sm" title="Back to all projects">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          <span>All Projects</span>
        </button>
        <h2 id="project-detail-name" style="margin: 0;">Project Name</h2>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button id="btn-recheck-readiness" class="btn-secondary btn-sm">Re-check Readiness</button>
        <button id="btn-delete-project" class="btn-secondary btn-sm btn-danger-hover">Delete Project</button>
      </div>
    </div>

    <div id="project-detail-meta" class="project-detail-meta-grid">
      <!-- Meta properties rendered here -->
    </div>

    <div id="project-detail-readiness-banner" class="readiness-banner">
      <!-- Readiness summary -->
    </div>

    <div class="project-repos-section" style="margin-top: 1.5rem;">
      <div class="section-header-flex" style="margin-bottom: 0.8rem;">
        <h3>Repositories</h3>
        <span id="project-detail-repo-count" class="nav-badge" style="display: inline-block;">0</span>
      </div>
      <div id="project-detail-repos-table" class="repos-table-container">
        <!-- Repositories rendered here -->
      </div>
    </div>
  </div>
</section>
`;

export function createProjectsView(): HTMLElement {
  return createViewFromTemplate(PROJECTS_TEMPLATE);
}
