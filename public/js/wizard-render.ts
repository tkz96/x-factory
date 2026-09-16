// public/js/wizard-render.ts — Extracted DOM rendering helpers for onboarding wizard with zero innerHTML.

import type {
  DiscoveredRepo,
  Project,
  ProjectRepository,
  RepositoryRole,
} from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { $ } from "./utils.js";
import type { SelectedWizardRepo, WizardState } from "./wizard-state.js";
import { inferRepoRole } from "./wizard-url.js";

const VALID_ROLES: RepositoryRole[] = [
  "frontend",
  "backend",
  "service",
  "worker",
  "mobile",
  "infrastructure",
  "documentation",
  "other",
];

export function updateTrackerFieldsVisibility(tracker: string): void {
  const azStep2 =
    $<HTMLElement>("#onboard-tracker-azure-fields-step2") ||
    $<HTMLElement>("#azure-tracker-fields");
  const azPat = $<HTMLElement>("#onboard-azure-pat-group");
  const ghGroup = $<HTMLElement>("#onboard-github-token-group");
  const jiraFields = $<HTMLElement>("#onboard-jira-fields");
  const hint = $<HTMLElement>("#onboard-tracker-project-hint");

  if (azStep2) {
    azStep2.hidden = tracker !== "azure";
    azStep2.style.display = tracker === "azure" ? "block" : "none";
  }
  if (azPat) {
    azPat.hidden = tracker !== "azure";
    azPat.style.display = tracker === "azure" ? "block" : "none";
  }
  if (ghGroup) {
    ghGroup.hidden = tracker !== "github";
    ghGroup.style.display = tracker === "github" ? "block" : "none";
  }
  if (jiraFields) {
    jiraFields.hidden = tracker !== "jira";
    jiraFields.style.display = tracker === "jira" ? "block" : "none";
  }

  if (hint) {
    hint.textContent =
      tracker === "github"
        ? "GitHub repository owner/repo or organization name."
        : tracker === "azure"
          ? "Azure DevOps project name (used with WIQL queries)."
          : "Jira project key (e.g. PROJ).";
  }
}

export function updateDiscoveryFieldsVisibility(source: string): void {
  const azGroup =
    $<HTMLElement>("#discovery-azure-group") ||
    $<HTMLElement>("#azure-discovery-fields");
  const ghGroup = $<HTMLElement>("#discovery-github-group");
  const localHint = $<HTMLElement>("#discovery-local-hint");

  if (azGroup) {
    azGroup.hidden = source !== "azure";
    azGroup.style.display = source === "azure" ? "block" : "none";
  }
  if (ghGroup) {
    ghGroup.hidden = source !== "github";
    ghGroup.style.display = source === "github" ? "block" : "none";
  }
  if (localHint) {
    localHint.hidden = source !== "local";
    localHint.style.display = source === "local" ? "block" : "none";
  }
}

function createRepoRoleDropdown(
  r: DiscoveredRepo,
  selectedRole: RepositoryRole,
  onRoleChange: (newRole: RepositoryRole) => void,
): HTMLElement {
  return el(
    "select",
    {
      className: "form-select form-select-sm repo-role-dropdown",
      attrs: { "data-repo": r.name },
      style: { padding: "0.2rem 0.5rem", "font-size": "0.78rem" },
      onChange: (e: Event) => {
        const val = (e.target as HTMLSelectElement).value as RepositoryRole;
        onRoleChange(val);
      },
    },
    VALID_ROLES.map((role) => {
      const opt = el("option", {
        value: role,
        textContent: role.charAt(0).toUpperCase() + role.slice(1),
      });
      if (role === selectedRole) opt.selected = true;
      return opt;
    }),
  );
}

function createRepoStarButton(
  r: DiscoveredRepo,
  isPrimary: boolean,
  onToggleStar: () => void,
): HTMLElement {
  return el("button", {
    type: "button",
    className: `primary-star-btn ${isPrimary ? "starred" : ""}`,
    attrs: {
      "data-repo": r.name,
      title: isPrimary
        ? "Primary Repository (Ticket anchor)"
        : "Click to designate as Primary Repository",
    },
    textContent: isPrimary ? "★" : "☆",
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      onToggleStar();
    },
  });
}

function createRepoCheckboxLabel(
  r: DiscoveredRepo,
  isPrimary: boolean,
  isSelected: boolean,
  onToggleSelect: (checked: boolean) => void,
): HTMLElement[] {
  const chk = el("input", {
    type: "checkbox",
    id: `chk-${r.name}`,
    onChange: (e: Event) => {
      const target = e.target as HTMLInputElement;
      onToggleSelect(target.checked);
    },
  });
  chk.checked = isSelected;

  const label = el(
    "label",
    {
      attrs: { for: `chk-${r.name}` },
      style: { cursor: "pointer", margin: "0", "font-weight": "500" },
    },
    [
      r.name,
      isPrimary
        ? el("span", {
            className: "primary-badge",
            style: { "margin-left": "0.4rem" },
            textContent: "★ Primary",
          })
        : null,
    ],
  );

  return [chk, label];
}

function createDiscoveredRepoItem(
  r: DiscoveredRepo,
  isPrimary: boolean,
  isSelected: boolean,
  selectedRole: RepositoryRole,
  onToggleStar: () => void,
  onToggleSelect: (checked: boolean) => void,
  onRoleChange: (newRole: RepositoryRole) => void,
): HTMLElement {
  const roleSelect = createRepoRoleDropdown(r, selectedRole, onRoleChange);
  const starBtn = createRepoStarButton(r, isPrimary, onToggleStar);
  const [chk, label] = createRepoCheckboxLabel(
    r,
    isPrimary,
    isSelected,
    onToggleSelect,
  );

  return el(
    "div",
    {
      className: `repo-check-item ${isSelected ? "selected" : ""}`,
    },
    [
      el("div", { className: "repo-check-left" }, [starBtn, chk, label]),
      el("div", { className: "repo-check-meta" }, [roleSelect]),
    ],
  );
}

function createTooltip(
  labelTitle: string,
  tooltipTitle: string,
  tooltipBody: string,
): HTMLElement {
  return el("div", { className: "label-with-tooltip" }, [
    el("label", {
      style: { "font-size": "0.75rem", "font-weight": "600" },
      textContent: labelTitle,
    }),
    el(
      "span",
      {
        className: "tooltip-badge",
        attrs: {
          tabindex: 0,
          role: "tooltip",
          "aria-label": `Help: ${labelTitle}`,
        },
      },
      [
        "?",
        el("span", { className: "tooltip-popover" }, [
          el("strong", { textContent: tooltipTitle }),
          document.createTextNode(` ${tooltipBody}`),
        ]),
      ],
    ),
  ]);
}

function createInspectionHeader(r: SelectedWizardRepo): HTMLElement {
  return el("div", { className: "inspection-header" }, [
    el("div", {}, [
      el("strong", {
        style: { "font-size": "0.95rem" },
        textContent: r.name,
      }),
      el("span", {
        className: "role-badge",
        style: { "margin-left": "0.4rem" },
        textContent: r.role || "other",
      }),
    ]),
    el("span", {
      className: "status-pill pending",
      id: `inspect-pill-${r.name}`,
      textContent: "Inspecting…",
    }),
  ]);
}

function createCommandField(
  r: SelectedWizardRepo,
  cmdType: "test" | "typecheck" | "lint",
  placeholder: string,
  label: string,
  tooltipBody: string,
  onCmdChange: (cmdType: "test" | "typecheck" | "lint", val: string) => void,
): HTMLElement {
  const input = el("input", {
    type: "text",
    className: `form-input code-input cmd-${cmdType}`,
    attrs: { "data-repo": r.name },
    placeholder,
    value: r.commands?.[cmdType] || "",
    onInput: (e: Event) => {
      onCmdChange(cmdType, (e.target as HTMLInputElement).value);
    },
  });

  return el("div", {}, [createTooltip(label, label, tooltipBody), input]);
}

function createInspectionCommandsGrid(
  r: SelectedWizardRepo,
  onCmdChange: (cmdType: "test" | "typecheck" | "lint", val: string) => void,
): HTMLElement {
  return el("div", { className: "inspection-commands-grid" }, [
    createCommandField(
      r,
      "test",
      "e.g. bun test",
      "Test Command",
      "Command to run automated tests (e.g. bun test, npm test, cargo test). Used by Pi to verify solutions.",
      onCmdChange,
    ),
    createCommandField(
      r,
      "typecheck",
      "e.g. bunx tsc --noEmit",
      "Typecheck Command",
      "Command to perform static type verification (e.g. bunx tsc --noEmit).",
      onCmdChange,
    ),
    createCommandField(
      r,
      "lint",
      "e.g. bunx eslint .",
      "Lint Command",
      "Command to check code style and lint rules (e.g. bunx eslint ., ruff check .).",
      onCmdChange,
    ),
  ]);
}

export function createInspectionCard(
  r: SelectedWizardRepo,
  wsRoot: string,
  onPathChange: (newPath: string) => void,
  onCmdChange: (cmdType: "test" | "typecheck" | "lint", val: string) => void,
): HTMLElement {
  const localPath = r.path || `${wsRoot.replace(/\/+$/, "")}/${r.name}`;

  const pathInput = el("input", {
    type: "text",
    className: "form-input code-input repo-path-input",
    attrs: { "data-repo": r.name },
    value: localPath,
    onInput: (e: Event) => {
      onPathChange((e.target as HTMLInputElement).value);
    },
  });

  return el(
    "div",
    {
      className: "inspection-card",
      id: `inspect-card-${r.name}`,
    },
    [
      createInspectionHeader(r),
      el(
        "div",
        { className: "form-group", style: { "margin-bottom": "0.5rem" } },
        [
          createTooltip(
            "Local Path",
            "Local Path",
            "Directory on your local machine where this repository checkout is located. X-Factory uses this folder to spawn isolated Git worktrees for tasks.",
          ),
          pathInput,
        ],
      ),
      createInspectionCommandsGrid(r, onCmdChange),
    ],
  );
}

function createArchitectureCardItem(
  label: string,
  value: string,
  subNodes: (Node | string)[],
): HTMLElement {
  return el("div", { className: "review-card-item" }, [
    el("div", { className: "review-card-label", textContent: label }),
    el("div", { className: "review-card-value", textContent: value }),
    el("div", { className: "review-card-sub" }, subNodes),
  ]);
}

function getTrackerDisplayName(trackerId?: string): string {
  if (trackerId === "azure") return "Azure DevOps";
  if (trackerId === "github") return "GitHub Issues";
  return "Jira";
}

function createArchitectureCardItems(
  config: Project,
  primaryRepo: string,
  knowledgeRepoId: string | null,
): HTMLElement[] {
  const trackerName = getTrackerDisplayName(
    config.issueTracker?.provider || config.issueTracker?.connectionId,
  );
  const primaryName =
    primaryRepo || config.repositories[0]?.name || "None specified";
  const kName =
    knowledgeRepoId ||
    config.knowledgeRepository?.repositoryId ||
    "None (Disabled)";

  return [
    createArchitectureCardItem("Project Workspace", config.name, [
      "ID: ",
      el("code", { textContent: config.id }),
      el("br"),
      "Path: ",
      el("code", { textContent: config.workspacePath || "None" }),
    ]),
    createArchitectureCardItem("Issue Tracker", trackerName, [
      "Project: ",
      el("strong", {
        textContent: config.issueTracker?.projectId || "Default",
      }),
      el("br"),
      "Auth: Active Session",
    ]),
    createArchitectureCardItem(
      "Multi-Repo Setup",
      `${config.repositories.length} Repositories`,
      [
        "Primary: ",
        el("strong", { textContent: primaryName }),
        el("br"),
        "Knowledge: ",
        el("strong", { textContent: kName }),
      ],
    ),
    createArchitectureCardItem("Worktree Isolation", "Autonomous", [
      "Isolated branches per ticket",
      el("br"),
      "Auto-verification active",
    ]),
  ];
}

function createReviewRepoRow(
  r: ProjectRepository,
  isPrimary: boolean,
): HTMLElement {
  const testCmdCell = r.commands?.test
    ? el("td", { style: { "font-size": "0.78rem" } }, [
        "Test: ",
        el("code", { textContent: r.commands.test }),
      ])
    : el("td", { style: { "font-size": "0.78rem" } }, [
        "Test: ",
        el("span", {
          style: { color: "var(--text-dim)" },
          textContent: "None",
        }),
      ]);

  return el("tr", {}, [
    el("td", {}, [
      el("strong", {
        style: { color: "var(--text-bright)" },
        textContent: r.name,
      }),
      isPrimary
        ? el("span", {
            className: "primary-badge",
            style: { "margin-left": "0.4rem" },
            textContent: "★ Primary",
          })
        : null,
    ]),
    el("td", {}, [
      el("span", {
        className: "role-badge",
        textContent: r.role || "other",
      }),
    ]),
    el("td", {}, [
      el("code", {
        style: { "font-size": "0.76rem" },
        textContent: r.path,
      }),
    ]),
    testCmdCell,
  ]);
}

export function renderReviewStepContent(
  config: Project,
  primaryRepo: string,
  knowledgeRepoId: string | null,
): void {
  const reviewJsonPreview = $<HTMLElement>("#review-json-preview");
  if (reviewJsonPreview) {
    reviewJsonPreview.textContent = JSON.stringify(config, null, 2);
  }

  const archCard = $<HTMLElement>("#review-architecture-card");
  if (archCard) {
    clearElement(archCard);
    archCard.append(
      ...createArchitectureCardItems(config, primaryRepo, knowledgeRepoId),
    );
  }

  const countLabel = $<HTMLElement>("#review-repo-count");
  if (countLabel) countLabel.textContent = String(config.repositories.length);

  const tbody = $<HTMLTableSectionElement>("#review-repos-tbody");
  if (tbody) {
    clearElement(tbody);
    for (const r of config.repositories) {
      const isPrimary =
        r.name.toLowerCase() === (primaryRepo || "").toLowerCase();
      tbody.appendChild(createReviewRepoRow(r, isPrimary));
    }
  }
}

export function renderDiscoveredReposList(
  s: WizardState,
  q: string,
  onPrimarySelect: (name: string, role: RepositoryRole) => void,
  onRepoToggle: (
    name: string,
    checked: boolean,
    role: RepositoryRole,
    isPrimary: boolean,
  ) => void,
  onRoleChange: (name: string, newRole: RepositoryRole) => void,
): void {
  const list = $<HTMLElement>("#onboard-repo-checklist");
  const countBadge = $<HTMLElement>("#onboard-discovered-count");
  const countLabel = $<HTMLElement>("#discovered-count-label");
  if (!list) return;

  const repos = s.discovered.filter(
    (r) => !q || r.name.toLowerCase().includes(q),
  );
  if (countBadge) countBadge.textContent = String(s.discovered.length);
  if (countLabel) {
    countLabel.textContent = `${s.discovered.length} repositories found`;
  }
  clearElement(list);

  for (const r of repos) {
    const isPrimary =
      r.name.toLowerCase() === (s.primaryRepo || "").toLowerCase();
    const isSelected = s.selectedRepos.has(r.name);
    const selectedRole =
      s.selectedRepos.get(r.name)?.role || inferRepoRole(r.name);

    list.appendChild(
      createDiscoveredRepoItem(
        r,
        isPrimary,
        isSelected,
        selectedRole,
        () => onPrimarySelect(r.name, selectedRole),
        (checked) => onRepoToggle(r.name, checked, selectedRole, isPrimary),
        (newRole) => onRoleChange(r.name, newRole),
      ),
    );
  }
}
