// public/js/projects.ts — Project catalog, cards, repository table, and detail view.

import type {
  IssueTrackerProvider,
  Project,
  ProjectReadiness,
  ProjectRepository,
  Run,
} from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { state } from "./state.js";
import { $, api, showError } from "./utils.js";

let onOpenWizardCallback: () => void = () => {};

export async function loadProjectsData(): Promise<void> {
  const selectProject = $<HTMLSelectElement>("#select-project");
  const setupError = $<HTMLElement>("#setup-error");

  try {
    const res = await fetch("/api/projects?includeArchived=true");
    const all = (await res.json()) as Project[];
    const list = Array.isArray(all) ? all : [];
    state.projects = list.filter((p) => !p.archived);
    state.archivedProjects = list.filter((p) => Boolean(p.archived));

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
      } else if (state.projects.length === 0) {
        clearElement(selectProject);
        const emptyOpt = el("option", {
          value: "",
          disabled: true,
          textContent: "No projects onboarded",
        });
        emptyOpt.selected = true;
        selectProject.appendChild(emptyOpt);
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

let activeProjectsTab: "active" | "archived" = "active";

export function setProjectsTab(tab: "active" | "archived"): void {
  activeProjectsTab = tab;
  const btnTabActive = $<HTMLButtonElement>("#btn-tab-active-projects");
  const btnToggleArchived = $<HTMLButtonElement>("#btn-toggle-archived");
  const projectsContainer = $<HTMLElement>("#projects-container");
  const archivedSection = $<HTMLElement>("#archived-projects-section");

  if (tab === "active") {
    if (btnTabActive) {
      btnTabActive.classList.add("active");
      btnTabActive.setAttribute("aria-selected", "true");
    }
    if (btnToggleArchived) {
      btnToggleArchived.classList.remove("active");
      btnToggleArchived.setAttribute("aria-selected", "false");
    }
    if (projectsContainer) projectsContainer.hidden = false;
    if (archivedSection) archivedSection.hidden = true;
  } else {
    if (btnTabActive) {
      btnTabActive.classList.remove("active");
      btnTabActive.setAttribute("aria-selected", "false");
    }
    if (btnToggleArchived) {
      btnToggleArchived.classList.add("active");
      btnToggleArchived.setAttribute("aria-selected", "true");
    }
    if (projectsContainer) projectsContainer.hidden = true;
    if (archivedSection) archivedSection.hidden = false;
  }
}

function createProjectCardHeader(
  p: Project,
  trackerLabel: string,
): HTMLElement {
  return el(
    "div",
    {
      className: "project-card-header",
    },
    [
      el("h3", {
        title: p.name,
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
  const trackerLabel =
    p.issueTracker?.provider || p.issueTracker?.connectionId || "None";
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
        el("strong", { textContent: "ID:" }),
        el("code", { title: p.id, textContent: p.id }),
      ]),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "Workspace:" }),
        el("code", { title: displayPath, textContent: displayPath }),
      ]),
      createProjectCardFooter(p, repoCount),
    ],
  );
}

function createArchivedProjectCard(p: Project): HTMLElement {
  const repoCount = (p.repositories || []).length;
  const trackerLabel =
    p.issueTracker?.provider || p.issueTracker?.connectionId || "None";
  const displayPath = p.workspacePath || p.repositoryPath || "Configured";

  return el(
    "div",
    {
      className: "project-card card",
      style: {
        opacity: "0.85",
        "border-style": "dashed",
        cursor: "pointer",
      },
      onClick: () => {
        void openProjectDetail(p.id);
      },
    },
    [
      el(
        "div",
        {
          className: "project-card-header",
        },
        [
          el("h3", {
            title: p.name,
            textContent: p.name,
          }),
          el("span", {
            className: "role-badge",
            style: {
              background: "var(--bg-tertiary)",
              color: "var(--text-muted)",
              "font-family": "var(--font-mono)",
              "font-size": "var(--text-caption-2)",
            },
            textContent: "Archived",
          }),
        ],
      ),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "ID:" }),
        el("code", { title: p.id, textContent: p.id }),
      ]),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "Workspace:" }),
        el("code", { title: displayPath, textContent: displayPath }),
      ]),
      el("div", { className: "project-card-meta" }, [
        el("strong", { textContent: "Tracker:" }),
        el("span", {
          className: "meta-val",
          title: `${trackerLabel} (Locked)`,
          textContent: `${trackerLabel} (Locked)`,
        }),
      ]),
      p.successorId
        ? el("div", { className: "project-card-meta" }, [
            el("strong", { textContent: "Successor:" }),
            el("code", { title: p.successorId, textContent: p.successorId }),
          ])
        : null,
      p.predecessorId
        ? el("div", { className: "project-card-meta" }, [
            el("strong", { textContent: "Predecessor:" }),
            el("code", {
              title: p.predecessorId,
              textContent: p.predecessorId,
            }),
          ])
        : null,
      createProjectCardFooter(p, repoCount),
    ],
  );
}

export function renderProjectsList(): void {
  const projectsContainer = $<HTMLElement>("#projects-container");
  const projectsListView = $<HTMLElement>("#projects-list-view");
  const projectsDetailView = $<HTMLElement>("#projects-detail-view");
  const archivedCount = $<HTMLElement>("#archived-projects-count");
  const activeCount = $<HTMLElement>("#active-projects-count");
  const archivedContainer = $<HTMLElement>("#archived-projects-container");

  if (!projectsContainer) return;
  if (projectsListView) projectsListView.hidden = false;
  if (projectsDetailView) projectsDetailView.hidden = true;

  if (activeCount) {
    activeCount.textContent = String(
      state.projects ? state.projects.length : 0,
    );
  }

  if (!state.projects || state.projects.length === 0) {
    clearElement(projectsContainer);
    projectsContainer.appendChild(
      el(
        "div",
        { className: "empty-state", style: { "grid-column": "1 / -1" } },
        [
          el("p", {
            textContent: "No active software products configured yet.",
          }),
          el("button", {
            id: "btn-empty-onboard",
            className: "btn-primary btn-sm",
            style: { "margin-top": "0.8rem" },
            textContent: "Onboard First Project",
            onClick: onOpenWizardCallback,
          }),
        ],
      ),
    );
  } else {
    clearElement(projectsContainer);
    for (const p of state.projects) {
      projectsContainer.appendChild(createProjectCard(p));
    }
  }

  // Archived projects rendering
  const archived = state.archivedProjects || [];
  if (archivedCount) {
    archivedCount.textContent = String(archived.length);
  }

  if (archivedContainer) {
    clearElement(archivedContainer);
    if (archived.length > 0) {
      for (const ap of archived) {
        archivedContainer.appendChild(createArchivedProjectCard(ap));
      }
    } else {
      archivedContainer.appendChild(
        el(
          "div",
          { className: "empty-state", style: { "grid-column": "1 / -1" } },
          [
            el("p", { textContent: "No archived projects." }),
            el("span", {
              className: "text-muted",
              style: { "font-size": "0.85rem" },
              textContent:
                "Projects that are migrated or retired will appear in this archive.",
            }),
          ],
        ),
      );
    }
  }

  setProjectsTab(activeProjectsTab);
}

export async function openProjectDetail(projectId: string): Promise<void> {
  state.activeDetailProjectId = projectId;
  const targetHash = `#/projects/${encodeURIComponent(projectId)}`;
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
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
  const trackerProvider =
    project.issueTracker?.provider ||
    project.issueTracker?.connectionId ||
    "github";
  const trackerTarget =
    trackerProvider === "azure"
      ? project.issueTracker?.azure?.project
      : trackerProvider === "jira"
        ? project.issueTracker?.jira?.project
        : project.issueTracker?.github?.repo;
  const trackerDesc = trackerTarget
    ? `${trackerProvider} / ${trackerTarget}`
    : trackerProvider;

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

  if (project.archived) {
    metaEl.append(
      el("div", {}, [
        el("strong", { textContent: "Status: " }),
        el("span", {
          className: "role-badge",
          style: {
            background: "var(--red-dim)",
            color: "var(--red)",
            "font-family": "var(--font-mono)",
            "font-size": "var(--text-caption-2)",
          },
          textContent: "Archived",
        }),
      ]),
    );
  }
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
  void renderProjectTrackerCard(project);
}

async function renderProjectTrackerCard(project: Project): Promise<void> {
  const trackerSection = $<HTMLElement>("#project-tracker-section");
  if (!trackerSection) return;
  clearElement(trackerSection);

  const tracker = project.issueTracker;
  const provider = (tracker?.provider ||
    tracker?.connectionId ||
    "github") as IssueTrackerProvider;
  const providerLabels: Record<IssueTrackerProvider, string> = {
    azure: "Azure DevOps",
    jira: "Jira",
    github: "GitHub Issues",
  };
  const providerLabel = providerLabels[provider] || provider;

  // Header
  const header = el(
    "div",
    {
      style: {
        display: "flex",
        "justify-content": "space-between",
        "align-items": "flex-start",
        "margin-bottom": "1rem",
        "flex-wrap": "wrap",
        gap: "0.5rem",
      },
    },
    [
      el("div", {}, [
        el(
          "h3",
          {
            style: {
              margin: "0 0 0.25rem 0",
              display: "flex",
              "align-items": "center",
              gap: "0.5rem",
            },
          },
          [
            el("span", { textContent: "Issue Tracker Connection" }),
            el("span", {
              className: "role-badge",
              style: {
                "font-size": "0.8rem",
                display: "inline-flex",
                "align-items": "center",
                gap: "0.25rem",
              },
              textContent: `🔒 ${providerLabel}`,
            }),
          ],
        ),
        el("p", {
          className: "text-muted",
          style: { margin: "0", "font-size": "0.82rem" },
          textContent:
            "Per-project issue tracker configuration. Provider and target are locked for ticket history integrity.",
        }),
      ]),
    ],
  );

  trackerSection.appendChild(header);

  // If archived, show banner and read-only details
  if (project.archived) {
    const archivedBanner = el(
      "div",
      {
        className: "alert",
        style: {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          "border-radius": "var(--radius-md)",
          padding: "0.75rem 1rem",
          "margin-bottom": "1rem",
          "font-size": "var(--text-callout)",
        },
      },
      [
        el("strong", { textContent: "⚠️ Archived Project: " }),
        document.createTextNode(
          `This project was archived${project.archivedAt ? ` on ${new Date(project.archivedAt).toLocaleDateString()}` : ""}. Its tracker settings are frozen. `,
        ),
        project.successorId
          ? el("span", {}, [
              document.createTextNode("Migrated to successor project: "),
              el("a", {
                href: "#/projects",
                style: {
                  "text-decoration": "underline",
                  cursor: "pointer",
                  "font-weight": "bold",
                },
                textContent: project.successorId,
                onClick: (e: MouseEvent) => {
                  e.preventDefault();
                  const targetId = project.successorId;
                  if (targetId) void openProjectDetail(targetId);
                },
              }),
            ])
          : null,
      ],
    );
    trackerSection.appendChild(archivedBanner);
  }

  // Target Details grid
  const detailsGrid = el("div", {
    className: "project-detail-meta-grid",
    style: { "margin-bottom": "1.2rem" },
  });

  if (provider === "azure") {
    detailsGrid.append(
      el("div", {}, [
        el("strong", { textContent: "Organization URL: " }),
        el("code", {
          textContent: tracker?.azure?.orgUrl || "Not configured",
        }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "Project: " }),
        el("code", {
          textContent:
            tracker?.azure?.project || tracker?.projectId || "Not configured",
        }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "Required Label: " }),
        el("code", {
          textContent: tracker?.azure?.requiredLabel || "agentic-workflow",
        }),
      ]),
    );
  } else if (provider === "jira") {
    detailsGrid.append(
      el("div", {}, [
        el("strong", { textContent: "Jira Host: " }),
        el("code", { textContent: tracker?.jira?.host || "Not configured" }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "User Email: " }),
        el("code", { textContent: tracker?.jira?.email || "Not configured" }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "Project Key: " }),
        el("code", {
          textContent:
            tracker?.jira?.project || tracker?.projectId || "Not configured",
        }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "Required Label: " }),
        el("code", {
          textContent: tracker?.jira?.requiredLabel || "agentic-workflow",
        }),
      ]),
    );
  } else if (provider === "github") {
    detailsGrid.append(
      el("div", {}, [
        el("strong", { textContent: "Repository: " }),
        el("code", {
          textContent:
            tracker?.github?.repo || tracker?.projectId || "Not configured",
        }),
      ]),
      el("div", {}, [
        el("strong", { textContent: "Required Label: " }),
        el("code", {
          textContent: tracker?.github?.requiredLabel || "agentic-workflow",
        }),
      ]),
    );
  }

  trackerSection.appendChild(detailsGrid);

  // If archived, stop here (no credential editing or migration allowed)
  if (project.archived) return;

  // Credential Status & Actions
  const credsContainer = el("div", {
    style: {
      padding: "1rem",
      background: "var(--bg-card, rgba(0,0,0,0.03))",
      border: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
      "border-radius": "6px",
      "margin-bottom": "1.2rem",
    },
  });

  const credsHeader = el("div", {
    style: {
      display: "flex",
      "justify-content": "space-between",
      "align-items": "center",
      "margin-bottom": "0.75rem",
      "flex-wrap": "wrap",
      gap: "0.5rem",
    },
  });

  const credStatusPill = el("span", {
    className: "status-pill pending",
    textContent: "Checking credentials…",
  });

  const credStatusLabel = el(
    "div",
    {
      style: { display: "flex", "align-items": "center", gap: "0.5rem" },
    },
    [el("strong", { textContent: "Credentials (.env): " }), credStatusPill],
  );

  const testBtn = el("button", {
    id: "btn-test-tracker-conn",
    className: "btn-secondary btn-sm",
    textContent: "Test Connection",
  });

  credsHeader.append(credStatusLabel, testBtn);
  credsContainer.appendChild(credsHeader);

  // Result box for connection testing
  const testResultBox = el("div", {
    id: "tracker-test-result-box",
    style: {
      "margin-bottom": "0.75rem",
      display: "none",
      "font-size": "0.82rem",
    },
  });
  credsContainer.appendChild(testResultBox);

  // Rotate / Update Credentials row
  const rotateRow = el("div", {
    style: {
      display: "flex",
      "align-items": "center",
      gap: "0.5rem",
      "flex-wrap": "wrap",
      "padding-top": "0.6rem",
      "border-top": "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
    },
  });

  const secretInput = el("input", {
    type: "password",
    id: "input-rotate-secret",
    placeholder:
      provider === "azure"
        ? "New Personal Access Token"
        : "New API Token / Password",
    style: {
      flex: "1",
      "min-width": "200px",
      padding: "0.35rem 0.6rem",
      "font-size": "0.82rem",
    },
  }) as HTMLInputElement;

  const saveSecretBtn = el("button", {
    id: "btn-save-rotate-secret",
    className: "btn-secondary btn-sm",
    textContent: "Save to .env",
  });

  const secretMsg = el("span", {
    style: { "font-size": "0.78rem", opacity: "0.8" },
  });

  rotateRow.append(
    el("label", {
      style: { "font-size": "0.82rem", "font-weight": "500" },
      textContent: "Rotate Token: ",
    }),
    secretInput,
    saveSecretBtn,
    secretMsg,
  );
  credsContainer.appendChild(rotateRow);
  trackerSection.appendChild(credsContainer);

  // Asynchronously load credential status
  const refreshCredentialStatus = async () => {
    try {
      const res = await api<{
        provider: string;
        hasSecret: boolean;
        secretMask: string;
        secretKey: string;
      }>("GET", `/projects/${encodeURIComponent(project.id)}/tracker`);

      if (res.hasSecret) {
        credStatusPill.className = "status-pill ready";
        credStatusPill.textContent = res.secretMask
          ? `✓ Configured in .env (ends in …${res.secretMask})`
          : `✓ Configured in .env`;
      } else {
        credStatusPill.className = "status-pill pending";
        credStatusPill.textContent = "⚠ Missing credentials in .env";
      }
    } catch {
      credStatusPill.className = "status-pill error";
      credStatusPill.textContent = "Error checking credentials";
    }
  };

  void refreshCredentialStatus();

  // Wire test connection button
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testBtn.textContent = "Testing…";
    testResultBox.style.display = "block";
    testResultBox.className = "connection-result";
    testResultBox.textContent = "Testing connection to issue tracker…";

    try {
      const res = await api<{
        ok: boolean;
        message?: string;
        error?: string;
      }>(
        "POST",
        `/projects/${encodeURIComponent(project.id)}/tracker/test`,
        {},
      );
      if (res.ok) {
        testResultBox.className = "connection-result success";
        testResultBox.textContent =
          res.message || "✓ Connection verified successfully.";
      } else {
        testResultBox.className = "connection-result error";
        testResultBox.textContent = `✗ Connection failed: ${res.error || "Unknown error"}`;
      }
    } catch (err) {
      testResultBox.className = "connection-result error";
      testResultBox.textContent = `✗ Connection error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test Connection";
    }
  });

  // Wire rotate secret button
  saveSecretBtn.addEventListener("click", async () => {
    const val = secretInput.value.trim();
    if (!val) {
      secretMsg.textContent = "Please enter a token first.";
      secretMsg.style.color = "var(--red)";
      return;
    }
    saveSecretBtn.disabled = true;
    saveSecretBtn.textContent = "Saving…";
    secretMsg.textContent = "";

    try {
      await api(
        "PUT",
        `/projects/${encodeURIComponent(project.id)}/tracker/credentials`,
        { secret: val },
      );
      secretInput.value = "";
      secretMsg.textContent = "✓ Saved to project .env";
      secretMsg.style.color = "var(--green)";
      await refreshCredentialStatus();
    } catch (err) {
      secretMsg.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      secretMsg.style.color = "var(--red)";
    } finally {
      saveSecretBtn.disabled = false;
      saveSecretBtn.textContent = "Save to .env";
    }
  });

  // Switch Tracker / Migrate Section
  const migrateSection = el("div", {
    style: {
      padding: "1rem",
      background: "var(--bg-surface, rgba(0,0,0,0.02))",
      border: "1px solid var(--border-subtle, rgba(0,0,0,0.1))",
      "border-radius": "6px",
    },
  });

  const migrateHeader = el(
    "div",
    {
      style: {
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        "flex-wrap": "wrap",
        gap: "0.5rem",
      },
    },
    [
      el("div", {}, [
        el("h4", {
          style: { margin: "0 0 0.2rem 0", "font-size": "0.95rem" },
          textContent: "Switch Tracker / Migrate Project",
        }),
        el("p", {
          className: "text-muted",
          style: { margin: "0", "font-size": "0.8rem" },
          textContent:
            "Changing tracker provider creates a successor project and archives this project.",
        }),
      ]),
    ],
  );

  // Active run guard check
  let activeRuns: Run[] = [];
  try {
    const allRuns = await api<Run[]>("GET", "/runs");
    state.allRuns = Array.isArray(allRuns) ? allRuns : [];
    activeRuns = state.allRuns.filter(
      (r) =>
        r.project?.id === project.id &&
        !["pr_created", "failed", "stopped"].includes(r.status),
    );
  } catch {
    activeRuns = (state.allRuns || []).filter(
      (r) =>
        r.project?.id === project.id &&
        !["pr_created", "failed", "stopped"].includes(r.status),
    );
  }

  const btnMigrate = el("button", {
    id: "btn-open-migrate-form",
    className: "btn-secondary btn-sm",
    textContent: "Switch Tracker…",
  }) as HTMLButtonElement;

  if (activeRuns.length > 0) {
    btnMigrate.disabled = true;
    btnMigrate.title = "Cannot migrate while project has active runs.";
  }

  migrateHeader.appendChild(btnMigrate);
  migrateSection.appendChild(migrateHeader);

  if (activeRuns.length > 0) {
    const warningEl = el(
      "div",
      {
        className: "alert",
        style: {
          "margin-top": "0.75rem",
          background: "var(--yellow-dim)",
          border: "1px solid var(--yellow)",
          "border-radius": "var(--radius-md)",
          padding: "0.6rem 0.8rem",
          "font-size": "var(--text-callout)",
        },
      },
      [
        el("strong", { textContent: "⚠ Active Run in Progress: " }),
        document.createTextNode(
          `Cannot switch tracker while active runs (${activeRuns.map((r) => r.id).join(", ")}) are executing. Please wait for them to finish or stop them manually before migrating.`,
        ),
      ],
    );
    migrateSection.appendChild(warningEl);
  }

  // Migration Form container (hidden until "Switch Tracker…" clicked)
  const migrateFormContainer = el("div", {
    id: "tracker-migration-form-container",
    style: {
      display: "none",
      "margin-top": "1rem",
      "padding-top": "1rem",
      "border-top": "1px solid var(--border-subtle, rgba(0,0,0,0.1))",
    },
  });

  renderMigrationForm(migrateFormContainer, project);
  migrateSection.appendChild(migrateFormContainer);

  btnMigrate.addEventListener("click", () => {
    const isHidden = migrateFormContainer.style.display === "none";
    migrateFormContainer.style.display = isHidden ? "block" : "none";
    btnMigrate.textContent = isHidden ? "Cancel Switch" : "Switch Tracker…";
  });

  trackerSection.appendChild(migrateSection);
}

function renderMigrationForm(container: HTMLElement, project: Project): void {
  clearElement(container);

  const formBox = el("div", {
    style: { display: "flex", "flex-direction": "column", gap: "0.8rem" },
  });

  // 1. Target Provider select
  const selectProvider = el("select", {
    id: "mig-select-provider",
    className: "form-select",
  }) as HTMLSelectElement;

  const currentProvider = project.issueTracker?.provider || "github";
  const providers: { val: IssueTrackerProvider; label: string }[] = [
    { val: "azure", label: "Azure DevOps" },
    { val: "github", label: "GitHub Issues" },
    { val: "jira", label: "Jira" },
  ];

  for (const p of providers) {
    const opt = el("option", { value: p.val, textContent: p.label });
    if (p.val !== currentProvider && !selectProvider.value) {
      opt.selected = true;
    }
    selectProvider.appendChild(opt);
  }

  const providerRow = el("div", { className: "form-group" }, [
    el("label", {
      style: { "font-weight": "500", "font-size": "0.85rem" },
      textContent: "Target Tracker Provider",
    }),
    selectProvider,
  ]);
  formBox.appendChild(providerRow);

  // 2. New Project ID & Name
  const inputNewId = el("input", {
    id: "mig-input-new-id",
    className: "form-input",
    value: `${project.id}-${selectProvider.value}`,
    placeholder: "successor-project-id",
  }) as HTMLInputElement;

  const inputNewName = el("input", {
    id: "mig-input-new-name",
    className: "form-input",
    value: project.name,
    placeholder: "Project Name",
  }) as HTMLInputElement;

  const projectInfoRow = el(
    "div",
    {
      style: {
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "0.8rem",
      },
    },
    [
      el("div", { className: "form-group" }, [
        el("label", {
          style: { "font-weight": "500", "font-size": "0.85rem" },
          textContent: "Successor Project ID",
        }),
        inputNewId,
      ]),
      el("div", { className: "form-group" }, [
        el("label", {
          style: { "font-weight": "500", "font-size": "0.85rem" },
          textContent: "Successor Project Name",
        }),
        inputNewName,
      ]),
    ],
  );
  formBox.appendChild(projectInfoRow);

  // 3. Provider-specific configuration fields container
  const providerFieldsContainer = el("div", { id: "mig-provider-fields" });
  formBox.appendChild(providerFieldsContainer);

  const renderProviderFields = () => {
    clearElement(providerFieldsContainer);
    const chosen = selectProvider.value as IssueTrackerProvider;
    inputNewId.value = `${project.id}-${chosen}`;

    if (chosen === "azure") {
      providerFieldsContainer.append(
        el(
          "div",
          {
            style: {
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "0.8rem",
              "margin-bottom": "0.6rem",
            },
          },
          [
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "Azure Org URL *",
              }),
              el("input", {
                id: "mig-azure-org-url",
                className: "form-input",
                placeholder: "https://dev.azure.com/organization",
                value: project.issueTracker?.azure?.orgUrl || "",
              }),
            ]),
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "Azure Project Name *",
              }),
              el("input", {
                id: "mig-azure-project",
                className: "form-input",
                placeholder: "MyProject",
                value: project.issueTracker?.azure?.project || "",
              }),
            ]),
          ],
        ),
        el("div", { className: "form-group" }, [
          el("label", {
            style: { "font-size": "0.85rem" },
            textContent:
              "Azure Personal Access Token (stored in new project .env) *",
          }),
          el("input", {
            id: "mig-azure-pat",
            type: "password",
            className: "form-input",
            placeholder: "PAT with Work Items Read/Write",
          }),
        ]),
      );
    } else if (chosen === "github") {
      providerFieldsContainer.append(
        el(
          "div",
          {
            style: {
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "0.8rem",
            },
          },
          [
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "GitHub Repo (owner/repo) *",
              }),
              el("input", {
                id: "mig-github-repo",
                className: "form-input",
                placeholder: "owner/repo",
                value: project.issueTracker?.github?.repo || "",
              }),
            ]),
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "GitHub Token (stored in new project .env) *",
              }),
              el("input", {
                id: "mig-github-token",
                type: "password",
                className: "form-input",
                placeholder: "ghp_...",
              }),
            ]),
          ],
        ),
      );
    } else if (chosen === "jira") {
      providerFieldsContainer.append(
        el(
          "div",
          {
            style: {
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "0.8rem",
              "margin-bottom": "0.6rem",
            },
          },
          [
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "Jira Host URL *",
              }),
              el("input", {
                id: "mig-jira-host",
                className: "form-input",
                placeholder: "https://your-domain.atlassian.net",
                value: project.issueTracker?.jira?.host || "",
              }),
            ]),
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "User Email *",
              }),
              el("input", {
                id: "mig-jira-email",
                className: "form-input",
                placeholder: "user@company.com",
                value: project.issueTracker?.jira?.email || "",
              }),
            ]),
          ],
        ),
        el(
          "div",
          {
            style: {
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "0.8rem",
            },
          },
          [
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "Project Key *",
              }),
              el("input", {
                id: "mig-jira-project",
                className: "form-input",
                placeholder: "PROJ",
                value: project.issueTracker?.jira?.project || "",
              }),
            ]),
            el("div", { className: "form-group" }, [
              el("label", {
                style: { "font-size": "0.85rem" },
                textContent: "API Token (stored in new project .env) *",
              }),
              el("input", {
                id: "mig-jira-token",
                type: "password",
                className: "form-input",
                placeholder: "Jira API token",
              }),
            ]),
          ],
        ),
      );
    }
  };

  selectProvider.addEventListener("change", renderProviderFields);
  renderProviderFields();

  // Status message container
  const statusMsg = el("div", {
    id: "mig-status-msg",
    style: { "font-size": "0.82rem" },
  });
  formBox.appendChild(statusMsg);

  // Submit and Cancel buttons
  const btnSubmit = el("button", {
    id: "btn-confirm-migration",
    className: "btn-primary btn-sm",
    textContent: "Confirm Migration & Archive Project",
  });

  const btnCancel = el("button", {
    id: "btn-cancel-migration",
    className: "btn-secondary btn-sm",
    textContent: "Cancel",
    onClick: () => {
      container.style.display = "none";
      const btnMigrate = $<HTMLButtonElement>("#btn-open-migrate-form");
      if (btnMigrate) btnMigrate.textContent = "Switch Tracker…";
    },
  });

  const actionsRow = el(
    "div",
    {
      style: {
        display: "flex",
        gap: "0.5rem",
        "margin-top": "0.5rem",
        "flex-wrap": "wrap",
      },
    },
    [btnSubmit, btnCancel],
  );
  formBox.appendChild(actionsRow);

  btnSubmit.addEventListener("click", async () => {
    const targetProvider = selectProvider.value as IssueTrackerProvider;
    const newId = inputNewId.value.trim();
    const newName = inputNewName.value.trim();

    if (!newId) {
      statusMsg.className = "error-message";
      statusMsg.textContent = "New project ID is required.";
      return;
    }

    const payload: Record<string, unknown> = {
      targetProvider,
      newProjectId: newId,
      name: newName || project.name,
    };

    if (targetProvider === "azure") {
      const orgUrl = (
        $<HTMLInputElement>("#mig-azure-org-url")?.value || ""
      ).trim();
      const azureProj = (
        $<HTMLInputElement>("#mig-azure-project")?.value || ""
      ).trim();
      const pat = ($<HTMLInputElement>("#mig-azure-pat")?.value || "").trim();
      if (!orgUrl || !azureProj) {
        statusMsg.className = "error-message";
        statusMsg.textContent =
          "Azure Organization URL and Project Name are required.";
        return;
      }
      payload.azure = { orgUrl, project: azureProj };
      if (pat) payload.secrets = { pat };
    } else if (targetProvider === "github") {
      const repo = (
        $<HTMLInputElement>("#mig-github-repo")?.value || ""
      ).trim();
      const token = (
        $<HTMLInputElement>("#mig-github-token")?.value || ""
      ).trim();
      if (!repo) {
        statusMsg.className = "error-message";
        statusMsg.textContent = "GitHub repository (owner/repo) is required.";
        return;
      }
      payload.github = { repo };
      if (token) payload.secrets = { token };
    } else if (targetProvider === "jira") {
      const host = ($<HTMLInputElement>("#mig-jira-host")?.value || "").trim();
      const email = (
        $<HTMLInputElement>("#mig-jira-email")?.value || ""
      ).trim();
      const jiraProj = (
        $<HTMLInputElement>("#mig-jira-project")?.value || ""
      ).trim();
      const token = (
        $<HTMLInputElement>("#mig-jira-token")?.value || ""
      ).trim();
      if (!host || !email || !jiraProj) {
        statusMsg.className = "error-message";
        statusMsg.textContent =
          "Jira host, email, and project key are required.";
        return;
      }
      payload.jira = { host, email, project: jiraProj };
      if (token) payload.secrets = { token };
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Migrating project…";
    statusMsg.className = "";
    statusMsg.textContent =
      "Archiving existing project and provisioning successor…";

    try {
      const res = await api<{ ok: boolean; newProjectId: string }>(
        "POST",
        `/projects/${encodeURIComponent(project.id)}/migrate`,
        payload,
      );
      await loadProjectsData();
      void openProjectDetail(res.newProjectId);
    } catch (err) {
      statusMsg.className = "error-message";
      statusMsg.textContent = `Migration failed: ${err instanceof Error ? err.message : String(err)}`;
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Confirm Migration & Archive Project";
    }
  });

  container.appendChild(formBox);
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

  const btnTabActive = $<HTMLButtonElement>("#btn-tab-active-projects");
  const btnToggleArchived = $<HTMLButtonElement>("#btn-toggle-archived");

  if (btnTabActive) {
    btnTabActive.addEventListener("click", () => {
      setProjectsTab("active");
    });
  }

  if (btnToggleArchived) {
    btnToggleArchived.addEventListener("click", () => {
      setProjectsTab("archived");
    });
  }

  if (btnBack) {
    btnBack.addEventListener("click", () => {
      window.location.hash = "#/projects";
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
