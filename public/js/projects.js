// fallow-ignore-file coverage-gaps
// public/js/projects.js — Project catalog, cards, repository table, and detail view.

import { $, escapeHtml, api, showError } from "./utils.js";
import { state } from "./state.js";

let onOpenWizardCallback = () => {};

export async function loadProjectsData() {
  const selectProject = $("#select-project");
  const setupError = $("#setup-error");

  try {
    state.projects = await api("GET", "/projects");
    if (selectProject) {
      selectProject.innerHTML = '<option value="" disabled selected>Select a project…</option>';
      for (const p of state.projects) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.id})`;
        selectProject.appendChild(opt);
      }
      if (state.projects.length > 0 && !selectProject.value) {
        selectProject.value = state.projects[0].id;
      }
    }
    updateKnowledgeStatus(selectProject?.value);
  } catch (err) {
    if (selectProject) {
      selectProject.innerHTML = '<option value="" disabled selected>Failed to load projects</option>';
    }
    showError(setupError, err instanceof Error ? err.message : String(err));
  }
}

export function updateKnowledgeStatus(projectId) {
  const knowledgeStatus = $("#knowledge-status");
  if (!knowledgeStatus) return;
  const project = state.projects.find((p) => p.id === projectId);

  if (project?.knowledgeRepositoryPath || project?.knowledgeRepository?.path) {
    knowledgeStatus.innerHTML = '<span class="check">✓</span> Knowledge repository configured';
  } else {
    knowledgeStatus.innerHTML = '<span class="missing">—</span> No knowledge repository configured';
  }
}

export function renderProjectsList() {
  const projectsContainer = $("#projects-container");
  const projectsListView = $("#projects-list-view");
  const projectsDetailView = $("#projects-detail-view");

  if (!projectsContainer) return;
  if (projectsListView) projectsListView.hidden = false;
  if (projectsDetailView) projectsDetailView.hidden = true;

  if (!state.projects || state.projects.length === 0) {
    projectsContainer.innerHTML = `
      <div class="empty-state">
        <p>No software products configured yet.</p>
        <button id="btn-empty-onboard" class="btn-primary btn-sm" style="margin-top: 0.8rem;">Onboard First Project</button>
      </div>`;
    const btnEmpty = $("#btn-empty-onboard");
    if (btnEmpty) btnEmpty.addEventListener("click", onOpenWizardCallback);
    return;
  }

  projectsContainer.innerHTML = "";
  for (const p of state.projects) {
    const card = document.createElement("div");
    card.className = "project-card card";
    const repoCount = (p.repositories || []).length;
    const trackerLabel = p.issueTracker?.connectionId || "None";
    const displayPath = p.workspacePath || p.repositoryPath || "Configured";

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem;">
        <h3 style="margin: 0; font-size: 1.05rem;">${escapeHtml(p.name)}</h3>
        <span class="role-badge">${escapeHtml(trackerLabel)}</span>
      </div>
      <div class="project-card-meta"><strong>ID:</strong> <code>${escapeHtml(p.id)}</code></div>
      <div class="project-card-meta"><strong>Workspace:</strong> <code>${escapeHtml(displayPath)}</code></div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.8rem; padding-top: 0.6rem; border-top: 1px solid var(--border-subtle);">
        <span class="nav-badge" style="display: inline-block;">${repoCount} ${repoCount === 1 ? "repo" : "repos"}</span>
        <span class="status-pill ready" id="card-readiness-${escapeHtml(p.id)}">View Details →</span>
      </div>
    `;

    card.addEventListener("click", () => openProjectDetail(p.id));
    projectsContainer.appendChild(card);
  }
}

export async function openProjectDetail(projectId) {
  state.activeDetailProjectId = projectId;
  window.location.hash = "#/projects";
  const selectProject = $("#select-project");
  if (selectProject) {
    selectProject.value = projectId;
    updateKnowledgeStatus(projectId);
  }

  const projectsListView = $("#projects-list-view");
  const projectsDetailView = $("#projects-detail-view");
  const projectDetailName = $("#project-detail-name");
  const projectDetailBanner = $("#project-detail-readiness-banner");

  if (projectsListView) projectsListView.hidden = true;
  if (projectsDetailView) projectsDetailView.hidden = false;

  if (projectDetailName) projectDetailName.textContent = "Loading project details…";
  if (projectDetailBanner) {
    projectDetailBanner.className = "readiness-banner pending";
    projectDetailBanner.innerHTML = "<span>Checking repository readiness…</span>";
  }

  try {
    const project = await api("GET", `/projects/${encodeURIComponent(projectId)}`);
    renderProjectDetailContent(project);
  } catch (err) {
    if (projectDetailName) projectDetailName.textContent = "Error Loading Project";
    if (projectDetailBanner) {
      projectDetailBanner.className = "readiness-banner error";
      projectDetailBanner.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

function renderProjectDetailHeader(project, readiness) {
  const projectDetailName = $("#project-detail-name");
  const projectDetailMeta = $("#project-detail-meta");
  const projectDetailRepoCount = $("#project-detail-repo-count");
  const projectDetailBanner = $("#project-detail-readiness-banner");

  if (projectDetailName) projectDetailName.textContent = project.name;

  if (projectDetailMeta) {
    const kPath = project.knowledgeRepository?.path || project.knowledgeRepositoryPath || "None configured";
    projectDetailMeta.innerHTML = `
      <div><strong>Product ID:</strong> <code>${escapeHtml(project.id)}</code></div>
      <div><strong>Workspace Root:</strong> <code>${escapeHtml(project.workspacePath || "None")}</code></div>
      <div><strong>Issue Tracker:</strong> <span class="role-badge">${escapeHtml(project.issueTracker?.connectionId || "github")}${project.issueTracker?.projectId ? ` / ${escapeHtml(project.issueTracker.projectId)}` : ""}</span></div>
      <div><strong>Knowledge Repo:</strong> <code>${escapeHtml(kPath)}</code></div>
    `;
  }

  if (projectDetailRepoCount) {
    projectDetailRepoCount.textContent = `${readiness.totalCount || (project.repositories || []).length}`;
  }

  if (projectDetailBanner) {
    if (readiness.ready) {
      projectDetailBanner.className = "readiness-banner ready";
      projectDetailBanner.innerHTML = `
        <span>✓ <strong>Project Ready</strong> — All ${readiness.totalCount} repositories checked out and verified.</span>
      `;
    } else {
      projectDetailBanner.className = "readiness-banner pending";
      projectDetailBanner.innerHTML = `
        <span>⚠ <strong>Setup Required</strong> — ${readiness.readyCount} of ${readiness.totalCount} repositories ready.</span>
      `;
    }
  }
}

function renderProjectDetailReposTable(repos, readiness) {
  const projectDetailReposTable = $("#project-detail-repos-table");
  if (!projectDetailReposTable) return;

  if (!repos || repos.length === 0) {
    projectDetailReposTable.innerHTML = `<div class="empty-state"><p>No repositories in this project.</p></div>`;
    return;
  }

  const readinessMap = new Map((readiness.repositories || []).map((r) => [r.repositoryId, r]));

  let tableHtml = `
    <table class="repos-table">
      <thead>
        <tr>
          <th>Repository</th>
          <th>Role</th>
          <th>Local Checkout</th>
          <th>Branch</th>
          <th>Remote</th>
          <th>Readiness</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of repos) {
    const rReadiness = readinessMap.get(r.id);
    const isReady = rReadiness?.status === "ready";
    const statusClass = isReady ? "ready" : "pending";
    const statusLabel = isReady ? "✓ Ready" : rReadiness?.message || "Pending Setup";

    tableHtml += `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="role-badge">${escapeHtml(r.role || "other")}</span></td>
        <td><code>${escapeHtml(r.path)}</code></td>
        <td><code>${escapeHtml(r.defaultBranch || "main")}</code></td>
        <td><span class="text-muted" style="font-size: 0.76rem;">${escapeHtml(r.remote || "—")}</span></td>
        <td><span class="status-pill ${statusClass}" title="${escapeHtml(rReadiness?.message || "")}">${escapeHtml(statusLabel)}</span></td>
      </tr>
    `;
  }

  tableHtml += `</tbody></table>`;
  projectDetailReposTable.innerHTML = tableHtml;
}

function renderProjectDetailContent(project) {
  const readiness = project.readiness || {
    ready: false,
    readyCount: 0,
    totalCount: 0,
    repositories: [],
    issues: [],
  };
  renderProjectDetailHeader(project, readiness);
  renderProjectDetailReposTable(project.repositories || [], readiness);
}

export function initProjects(openWizardFn) {
  if (openWizardFn) onOpenWizardCallback = openWizardFn;

  const btnBackToProjectsList = $("#btn-back-to-projects-list");
  const btnRecheckReadiness = $("#btn-recheck-readiness");
  const btnDeleteProject = $("#btn-delete-project");
  const projectsDetailView = $("#projects-detail-view");
  const projectsListView = $("#projects-list-view");

  if (btnBackToProjectsList) {
    btnBackToProjectsList.addEventListener("click", () => {
      if (projectsDetailView) projectsDetailView.hidden = true;
      if (projectsListView) projectsListView.hidden = false;
      renderProjectsList();
    });
  }

  if (btnRecheckReadiness) {
    btnRecheckReadiness.addEventListener("click", () => {
      if (state.activeDetailProjectId) openProjectDetail(state.activeDetailProjectId);
    });
  }

  if (btnDeleteProject) {
    btnDeleteProject.addEventListener("click", async () => {
      if (!state.activeDetailProjectId) return;
      if (!confirm(`Are you sure you want to remove project "${state.activeDetailProjectId}" from X-Factory?`)) {
        return;
      }
      try {
        await api("DELETE", `/projects/${encodeURIComponent(state.activeDetailProjectId)}`);
        await loadProjectsData();
        if (projectsDetailView) projectsDetailView.hidden = true;
        if (projectsListView) projectsListView.hidden = false;
        renderProjectsList();
      } catch (err) {
        alert(`Failed to delete project: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }
}
