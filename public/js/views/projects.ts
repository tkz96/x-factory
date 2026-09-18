// public/js/views/projects.ts — Configured Projects area static template.

import { createViewFromTemplate } from "./template-helper.js";

const PROJECTS_TEMPLATE = `
<section id="area-projects" class="area-view">
  <!-- Projects List Sub-view -->
  <div id="projects-list-view" class="view-panel">
    <div class="section-header-flex">
      <div>
        <h2>Configured Projects</h2>
        <p class="text-muted">Software products and multi-repository workspaces connected to X-Factory.</p>
      </div>
      <button id="btn-open-onboard-modal" class="btn-primary">
        <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-plus"></use></svg>
        <span>Onboard Project</span>
      </button>
    </div>
    <!-- Switchable Tabs: Active / Archived -->
    <div class="projects-tab-bar">
      <div class="projects-segmented-control" role="tablist" aria-label="Projects Views">
        <button type="button" class="projects-tab-btn active" id="btn-tab-active-projects" role="tab" aria-selected="true">
          <span>Active Projects</span>
          <span id="active-projects-count" class="projects-tab-badge">0</span>
        </button>
        <button type="button" class="projects-tab-btn" id="btn-toggle-archived" role="tab" aria-selected="false">
          <span>Archived Projects</span>
          <span id="archived-projects-count" class="projects-tab-badge">0</span>
        </button>
      </div>
    </div>

    <!-- Active Projects Tab Content -->
    <div id="projects-container" class="projects-grid">
      <!-- Projects rendered here -->
    </div>

    <!-- Switchable Archived Projects Section -->
    <div id="archived-projects-section" hidden>
      <div id="archived-projects-container" class="projects-grid">
        <!-- Archived projects rendered here -->
      </div>
    </div>
  </div>

  <!-- Project Detail Sub-view (hidden by default) -->
  <div id="projects-detail-view" class="view-panel" hidden>
    <div class="section-header-flex">
      <div style="display: flex; align-items: center; gap: 0.8rem;">
        <button id="btn-back-to-projects-list" class="btn-secondary btn-sm" title="Back to all projects" aria-label="Back to all projects">
          <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-arrow-left"></use></svg>
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

    <div id="project-tracker-section" class="project-tracker-card card" style="margin-top: 1.5rem;">
      <!-- Dedicated Tracker Card rendered here -->
    </div>

    <div class="project-repos-section" style="margin-top: 1.5rem;">
      <div class="section-header-flex" style="margin-bottom: 0.8rem;">
        <h3>Repositories</h3>
        <span id="project-detail-repo-count" class="nav-badge" style="display: inline-block; font-family: var(--font-mono);">0</span>
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
