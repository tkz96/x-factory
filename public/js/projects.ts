// public/js/projects.ts — Project catalog, cards, repository table, and detail view.

import type {
  Project,
  ProjectReadiness,
  ProjectRepository,
} from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { state } from "./state.js";
import { $, showError } from "./utils.js";

let onOpenWizardCallback: () => void = () => {};

export async function loadProjectsData(): Promise<void> {
  const selectProject = $<HTMLSelectElement>("#select-project");
  const setupError = $<HTMLElement>("#setup-error");

  try {
    const projects = await fetch("/api/projects").then((r) => r.json());
    state.projects = Array.isArray(projects) ? (projects as Project[]) : [];
    if (selectProject) {
      clearElement(selectProject);
      const defaultOpt = el("option", {
        value: "",
        disabled: true,
        textContent: "Select a project…",
      });
      defaultOpt.selected = true;
      selectProject.appendChild(defaultOpt);

      for (const p of state.projects) {
        const opt = el("option", {
          value: p.id,
          textContent: `${p.name} (${p.id})`,
        });
        selectProject.appendChild(opt);
      }
      if (state.projects.length > 0 && !selectProject.value) {
        selectProject.value = state.projects[0]?.id || "";
      }
    }
    updateKnowledgeStatus(selectProject?.value);
  } catch (err) {
    if (selectProject) {
      clearElement(selectProject);
      const errOpt = el("option", {
        value: "",
        disabled: true,
        textContent: "Failed to load projects",
      });
      errOpt.selected = true;
      selectProject.appendChild(errOpt);
    }
    showError(setupError, err instanceof Error ? err.message : String(err));
  }
}

export function updateKnowledgeStatus(projectId: string | undefined): void {
  const knowledgeStatus = $<HTMLElement>("#knowledge-status");
  if (!knowledgeStatus) return;
  const project = state.projects.find((p) => p.id === projectId);

  clearElement(knowledgeStatus);
  if (project?.knowledgeRepositoryPath || project?.knowledgeRepository?.path) {
    knowledgeStatus.appendChild(
      el("span", { className: "check", textContent: "✓ " }),
    );
    knowledgeStatus.appendChild(
      document.createTextNode("Knowledge repository configured"),
    );
  } else {
    knowledgeStatus.appendChild(
      el("span", { className: "missing", textContent: "— " }),
    );
    knowledgeStatus.appendChild(
      document.createTextNode("No knowledge repository configured"),
    );
  }
}

function createProjectCardHeader(
  p: Project,
  trackerLabel: string,
): HTMLElement {
  return el(
    "div",
    {
      style: {
        display: "flex",
        "justify-content": "space-between",
        "align-items": "flex-start",
        "margin-bottom": "0.6rem",
      },
    },
    [
      el("h3", {
        style: { margin: "0", "font-size": "1.05rem" },
        textContent: p.name,
      }),
      el("span", {
        className: "role-badge",
        textContent: trackerLabel,
      }),
    ],
  );
}

function createProjectCardFooter(p: Project, repoCount: number): HTMLElement {
  return el(
    "div",
    {
      style: {
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        "margin-top": "0.8rem",
        "padding-top": "0.6rem",
        "border-top": "1px solid var(--border-subtle)",
      },
    },
    [
      el("span", {
        className: "nav-badge",
        style: { display: "inline-block" },
        textContent: `${repoCount} ${repoCount === 1 ? "repo" : "repos"}`,
      }),
      el("span", {
        className: "status-pill ready",
        id: `card-readiness-${p.id}`,
        textContent: "View Details →",
      }),
    ],
  );
}

function createProjectCard(p: Project): HTMLElement {
  const repoCount = (p.repositories || []).length;
  const trackerLabel = p.issueTracker?.connectionId || "None";
  const displayPath = p.workspacePath || p.repositoryPath || "Configured";

  return el(
    "div",
    {
      className: "project-card card",
      onClick: () => {
        void openProjectDetail(p.id);
      },
    },
    [
      createProjectCardHeader(p, trackerLabel),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "ID: " }),
        el("code", { textContent: p.id }),
      ]),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "Workspace: " }),
        el("code", { textContent: displayPath }),
      ]),
      createProjectCardFooter(p, repoCount),
    ],
  );
}

export function renderProjectsList(): void {
  const projectsContainer = $<HTMLElement>("#projects-container");
  const projectsListView = $<HTMLElement>("#projects-list-view");
  const projectsDetailView = $<HTMLElement>("#projects-detail-view");

  if (!projectsContainer) return;
  if (projectsListView) projectsListView.hidden = false;
  if (projectsDetailView) projectsDetailView.hidden = true;

  if (!state.projects || state.projects.length === 0) {
    clearElement(projectsContainer);
    projectsContainer.appendChild(
      el("div", { className: "empty-state" }, [
        el("p", { textContent: "No software products configured yet." }),
        el("button", {
          id: "btn-empty-onboard",
          className: "btn-primary btn-sm",
          style: { "margin-top": "0.8rem" },
          textContent: "Onboard First Project",
          onClick: onOpenWizardCallback,
        }),
      ]),
    );
    return;
  }

  clearElement(projectsContainer);
  for (const p of state.projects) {
    projectsContainer.appendChild(createProjectCard(p));
  }
}

export async function openProjectDetail(projectId: string): Promise<void> {
  state.activeDetailProjectId = projectId;
  window.location.hash = "#/projects";
  const selectProject = $<HTMLSelectElement>("#select-project");
  if (selectProject) {
    selectProject.value = projectId;
    updateKnowledgeStatus(projectId);
  }

  const projectsListView = $<HTMLElement>("#projects-list-view");
  const projectsDetailView = $<HTMLElement>("#projects-detail-view");
  const projectDetailName = $<HTMLElement>("#project-detail-name");
  const projectDetailBanner = $<HTMLElement>(
    "#project-detail-readiness-banner",
  );

  if (projectsListView) projectsListView.hidden = true;
  if (projectsDetailView) projectsDetailView.hidden = false;

  if (projectDetailName) {
    projectDetailName.textContent = "Loading project details…";
  }
  if (projectDetailBanner) {
    projectDetailBanner.className = "readiness-banner pending";
    clearElement(projectDetailBanner);
    projectDetailBanner.appendChild(
      el("span", { textContent: "Checking repository readiness…" }),
    );
  }

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
    const project = (await res.json()) as Project & {
      readiness?: ProjectReadiness;
    };
    renderProjectDetailContent(project);
  } catch (err) {
    if (projectDetailName) {
      projectDetailName.textContent = "Error Loading Project";
    }
    if (projectDetailBanner) {
      projectDetailBanner.className = "readiness-banner error";
      projectDetailBanner.textContent =
        err instanceof Error ? err.message : String(err);
    }
  }
}

function renderProjectDetailMeta(metaEl: HTMLElement, project: Project): void {
  const kPath =
    project.knowledgeRepository?.path ||
    project.knowledgeRepositoryPath ||
    "None configured";
  const trackerDesc = `${project.issueTracker?.connectionId || "github"}${project.issueTracker?.projectId ? ` / ${project.issueTracker.projectId}` : ""}`;

  clearElement(metaEl);
  metaEl.append(
    el("div", {}, [
      el("strong", { textContent: "Product ID: " }),
      el("code", { textContent: project.id }),
    ]),
    el("div", {}, [
      el("strong", { textContent: "Workspace Root: " }),
      el("code", { textContent: project.workspacePath || "None" }),
    ]),
    el("div", {}, [
      el("strong", { textContent: "Issue Tracker: " }),
      el("span", { className: "role-badge", textContent: trackerDesc }),
    ]),
    el("div", {}, [
      el("strong", { textContent: "Knowledge Repo: " }),
      el("code", { textContent: kPath }),
    ]),
  );
}

function renderProjectDetailHeader(
  project: Project,
  readiness: ProjectReadiness,
): void {
  const projectDetailName = $<HTMLElement>("#project-detail-name");
  const projectDetailMeta = $<HTMLElement>("#project-detail-meta");
  const projectDetailRepoCount = $<HTMLElement>("#project-detail-repo-count");
  const projectDetailBanner = $<HTMLElement>(
    "#project-detail-readiness-banner",
  );

  if (projectDetailName) projectDetailName.textContent = project.name;
  if (projectDetailMeta) renderProjectDetailMeta(projectDetailMeta, project);
  if (projectDetailRepoCount) {
    projectDetailRepoCount.textContent = `${readiness.totalCount || (project.repositories || []).length}`;
  }

  if (projectDetailBanner) {
    clearElement(projectDetailBanner);
    if (readiness.ready) {
      projectDetailBanner.className = "readiness-banner ready";
      projectDetailBanner.appendChild(
        el("span", {}, [
          "✓ ",
          el("strong", { textContent: "Project Ready" }),
          ` — All ${readiness.totalCount} repositories checked out and verified.`,
        ]),
      );
    } else {
      projectDetailBanner.className = "readiness-banner pending";
      projectDetailBanner.appendChild(
        el("span", {}, [
          "⚠ ",
          el("strong", { textContent: "Setup Required" }),
          ` — ${readiness.readyCount} of ${readiness.totalCount} repositories ready.`,
        ]),
      );
    }
  }
}

function createProjectDetailRepoRow(
  r: ProjectRepository,
  rReadiness: { status?: string; message?: string } | undefined,
): HTMLElement {
  const isReady = rReadiness?.status === "ready";
  const statusClass = isReady ? "ready" : "pending";
  const statusLabel = isReady
    ? "✓ Ready"
    : rReadiness?.message || "Pending Setup";

  return el("tr", {}, [
    el("td", {}, [el("strong", { textContent: r.name })]),
    el("td", {}, [
      el("span", {
        className: "role-badge",
        textContent: r.role || "other",
      }),
    ]),
    el("td", {}, [el("code", { textContent: r.path })]),
    el("td", {}, [el("code", { textContent: r.defaultBranch || "main" })]),
    el("td", {}, [
      el("span", {
        className: "text-muted",
        style: { "font-size": "0.76rem" },
        textContent: r.remote || "—",
      }),
    ]),
    el("td", {}, [
      el("span", {
        className: `status-pill ${statusClass}`,
        title: rReadiness?.message || "",
        textContent: statusLabel,
      }),
    ]),
  ]);
}

function createProjectDetailTable(
  repos: ProjectRepository[],
  readinessMap: Map<string, { status?: string; message?: string }>,
): HTMLElement {
  const tbody = el("tbody");
  for (const r of repos) {
    tbody.appendChild(createProjectDetailRepoRow(r, readinessMap.get(r.id)));
  }

  return el("table", { className: "repos-table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { textContent: "Repository" }),
        el("th", { textContent: "Role" }),
        el("th", { textContent: "Local Checkout" }),
        el("th", { textContent: "Branch" }),
        el("th", { textContent: "Remote" }),
        el("th", { textContent: "Readiness" }),
      ]),
    ]),
    tbody,
  ]);
}

function renderProjectDetailReposTable(
  repos: ProjectRepository[],
  readiness: ProjectReadiness,
): void {
  const projectDetailReposTable = $<HTMLElement>("#project-detail-repos-table");
  if (!projectDetailReposTable) return;

  if (!repos || repos.length === 0) {
    clearElement(projectDetailReposTable);
    projectDetailReposTable.appendChild(
      el("div", { className: "empty-state" }, [
        el("p", { textContent: "No repositories in this project." }),
      ]),
    );
    return;
  }

  const readinessMap = new Map(
    (readiness.repositories || []).map((r) => [r.repositoryId, r]),
  );
  const table = createProjectDetailTable(repos, readinessMap);

  clearElement(projectDetailReposTable);
  projectDetailReposTable.appendChild(table);
}

function renderProjectDetailContent(
  project: Project & { readiness?: ProjectReadiness },
): void {
  const readiness: ProjectReadiness = project.readiness || {
    projectId: project.id,
    ready: false,
    readyCount: 0,
    totalCount: 0,
    repositories: [],
    issues: [],
  };
  renderProjectDetailHeader(project, readiness);
  renderProjectDetailReposTable(project.repositories || [], readiness);
}

async function handleDeleteProject(): Promise<void> {
  if (!state.activeDetailProjectId) return;
  if (
    !confirm(
      `Are you sure you want to remove project "${state.activeDetailProjectId}" from X-Factory?`,
    )
  ) {
    return;
  }
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(state.activeDetailProjectId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    await loadProjectsData();
    const projectsDetailView = $<HTMLElement>("#projects-detail-view");
    const projectsListView = $<HTMLElement>("#projects-list-view");
    if (projectsDetailView) projectsDetailView.hidden = true;
    if (projectsListView) projectsListView.hidden = false;
    renderProjectsList();
  } catch (err) {
    alert(
      `Failed to delete project: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function initProjects(openWizardFn: () => void): void {
  if (openWizardFn) onOpenWizardCallback = openWizardFn;

  const btnBack = $<HTMLButtonElement>("#btn-back-to-projects-list");
  const btnRecheck = $<HTMLButtonElement>("#btn-recheck-readiness");
  const btnDelete = $<HTMLButtonElement>("#btn-delete-project");
  const detailView = $<HTMLElement>("#projects-detail-view");
  const listView = $<HTMLElement>("#projects-list-view");

  if (btnBack) {
    btnBack.addEventListener("click", () => {
      if (detailView) detailView.hidden = true;
      if (listView) listView.hidden = false;
      renderProjectsList();
    });
  }

  if (btnRecheck) {
    btnRecheck.addEventListener("click", () => {
      if (state.activeDetailProjectId) {
        void openProjectDetail(state.activeDetailProjectId);
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener("click", () => {
      void handleDeleteProject();
    });
  }
}
