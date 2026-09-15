// fallow-ignore-file coverage-gaps
// public/js/wizard.js — 6-step project onboarding wizard, repository discovery, and inspection.

import { $, $$, escapeHtml, getVal, api } from "./utils.js";
import { loadProjectsData, openProjectDetail } from "./projects.js";

const onboardState = {
  step: 1,
  name: "",
  id: "",
  workspacePath: "",
  issueTracker: { connectionId: "azure", projectId: "" },
  primaryRepo: "",
  discovered: [],
  selectedRepos: new Map(), // name -> { ...repo, role, localPath, commands }
  knowledgeRepoId: "",
};

function setOnboardError(msg) {
  const onboardErrorBox = $("#onboard-error-box");
  if (!onboardErrorBox) return;
  if (!msg) {
    onboardErrorBox.hidden = true;
    onboardErrorBox.textContent = "";
  } else {
    onboardErrorBox.hidden = false;
    onboardErrorBox.textContent = msg;
  }
}

export function openOnboardModal() {
  onboardState.step = 1;
  onboardState.name = "";
  onboardState.id = "";
  onboardState.workspacePath = "";
  onboardState.issueTracker = { connectionId: "azure", projectId: "" };
  onboardState.primaryRepo = "";
  onboardState.discovered = [];
  onboardState.selectedRepos.clear();
  onboardState.knowledgeRepoId = "";

  const nameInput = $("#onboard-proj-name");
  const idInput = $("#onboard-proj-id");
  const wsInput = $("#onboard-workspace-path");
  const trackerSel = $("#onboard-tracker-connection");
  const trackerProj = $("#onboard-tracker-project");
  const primInput = $("#onboard-primary-repo");
  const sourceSel = $("#onboard-discovery-source");
  const discoveryStatusText = $("#discovery-status-text");
  const onboardErrorBox = $("#onboard-error-box");
  const modalOnboard = $("#modal-project-onboarding");

  if (nameInput) nameInput.value = "";
  if (idInput) idInput.value = "";
  if (wsInput) wsInput.value = "";
  if (trackerSel) trackerSel.value = "azure";
  if (trackerProj) trackerProj.value = "";
  if (primInput) primInput.value = "";
  if (sourceSel) sourceSel.value = "local";
  if (discoveryStatusText) discoveryStatusText.textContent = "";
  if (onboardErrorBox) {
    onboardErrorBox.hidden = true;
    onboardErrorBox.textContent = "";
  }

  goToOnboardStep(1);
  if (modalOnboard) modalOnboard.hidden = false;
}

function closeOnboardModal() {
  const modalOnboard = $("#modal-project-onboarding");
  if (modalOnboard) modalOnboard.hidden = true;
}

function updateDiscoveryFieldsVisibility() {
  const azureDiscoveryFields = $("#azure-discovery-fields");
  const onboardDiscoverySource = $("#onboard-discovery-source");
  if (!azureDiscoveryFields) return;
  const val = onboardDiscoverySource ? onboardDiscoverySource.value : "local";
  azureDiscoveryFields.style.display = val === "azure" ? "block" : "none";
}

function populateKnowledgeDropdown(repos) {
  const onboardKnowledgeSelect = $("#onboard-knowledge-select");
  if (!onboardKnowledgeSelect) return;
  onboardKnowledgeSelect.innerHTML = `<option value="">No knowledge repository</option>`;
  for (const r of repos) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = `${r.name} (${r.remote || "local"})`;
    if (r.name === onboardState.knowledgeRepoId) opt.selected = true;
    onboardKnowledgeSelect.appendChild(opt);
  }
  onboardKnowledgeSelect.onchange = (e) => {
    onboardState.knowledgeRepoId = e.target.value;
    if (e.target.value) {
      onboardState.selectedRepos.delete(e.target.value);
      renderDiscoveredRepos();
    }
  };
}

function createDiscoveredRepoItem(r, isPrimary) {
  const isSelected = onboardState.selectedRepos.has(r.name);
  const selectedData = onboardState.selectedRepos.get(r.name) || r;

  const item = document.createElement("div");
  item.className = `repo-check-item ${isSelected ? "selected" : ""}`;
  item.innerHTML = `
    <div class="repo-check-left">
      <input type="checkbox" id="chk-${escapeHtml(r.name)}" ${isSelected ? "checked" : ""}>
      <label for="chk-${escapeHtml(r.name)}" style="cursor: pointer; margin: 0; font-weight: 500;">
        ${escapeHtml(r.name)}
        ${isPrimary ? '<span class="primary-badge" style="margin-left: 0.4rem;">Primary</span>' : ""}
      </label>
    </div>
    <div class="repo-check-meta">
      <select class="form-select form-select-sm repo-role-dropdown" data-repo="${escapeHtml(r.name)}" style="padding: 0.2rem 0.5rem; font-size: 0.78rem;">
        <option value="frontend" ${selectedData.role === "frontend" ? "selected" : ""}>Frontend</option>
        <option value="backend" ${selectedData.role === "backend" ? "selected" : ""}>Backend</option>
        <option value="service" ${selectedData.role === "service" ? "selected" : ""}>Service</option>
        <option value="worker" ${selectedData.role === "worker" ? "selected" : ""}>Worker</option>
        <option value="mobile" ${selectedData.role === "mobile" ? "selected" : ""}>Mobile</option>
        <option value="infrastructure" ${selectedData.role === "infrastructure" ? "selected" : ""}>Infrastructure</option>
        <option value="documentation" ${selectedData.role === "documentation" ? "selected" : ""}>Documentation</option>
        <option value="other" ${selectedData.role === "other" || !selectedData.role ? "selected" : ""}>Other</option>
      </select>
    </div>
  `;

  const chk = item.querySelector(`input[type="checkbox"]`);
  chk?.addEventListener("change", (e) => {
    if (e.target.checked) {
      onboardState.selectedRepos.set(r.name, {
        ...r,
        role: item.querySelector(".repo-role-dropdown")?.value || "other",
        isPrimary,
      });
      item.classList.add("selected");
    } else {
      onboardState.selectedRepos.delete(r.name);
      item.classList.remove("selected");
    }
  });

  const roleDropdown = item.querySelector(".repo-role-dropdown");
  roleDropdown?.addEventListener("change", (e) => {
    if (onboardState.selectedRepos.has(r.name)) {
      onboardState.selectedRepos.get(r.name).role = e.target.value;
    }
  });

  return item;
}

function renderDiscoveredRepos() {
  const onboardRepoChecklist = $("#onboard-repo-checklist");
  const onboardRepoSearch = $("#onboard-repo-search");
  if (!onboardRepoChecklist) return;

  const repos = onboardState.discovered || [];
  const countLabel = $("#discovered-count-label");
  if (countLabel) countLabel.textContent = `${repos.length} repositories found`;

  populateKnowledgeDropdown(repos);

  const searchTerm = (onboardRepoSearch?.value || "").toLowerCase().trim();
  onboardRepoChecklist.innerHTML = "";

  for (const r of repos) {
    if (r.name === onboardState.knowledgeRepoId) continue;
    if (searchTerm && !r.name.toLowerCase().includes(searchTerm)) continue;

    const isPrimary = r.name.toLowerCase() === (onboardState.primaryRepo || "").toLowerCase();
    const item = createDiscoveredRepoItem(r, isPrimary);
    onboardRepoChecklist.appendChild(item);
  }
}

async function inspectRepoAsync(repo) {
  const pill = $(`#inspect-pill-${repo.name}`);
  const card = $(`#inspect-card-${repo.name}`);
  try {
    const data = await api("POST", "/projects/inspect-repository", {
      path: repo.localPath,
      expectedRemote: repo.remote,
    });

    if (pill) {
      if (data.isGitRepo) {
        pill.className = "status-pill ready";
        pill.textContent = "✓ Git Repo Detected";
      } else if (data.exists) {
        pill.className = "status-pill pending";
        pill.textContent = "⚠ Not a Git Repo";
      } else {
        pill.className = "status-pill pending";
        pill.textContent = "⚠ Checkout Missing";
      }
    }

    if (data.detectedCommands) {
      const testInput = card?.querySelector(`.cmd-test`);
      const typecheckInput = card?.querySelector(`.cmd-typecheck`);
      const lintInput = card?.querySelector(`.cmd-lint`);

      if (testInput && !testInput.value && data.detectedCommands.test) testInput.value = data.detectedCommands.test;
      if (typecheckInput && !typecheckInput.value && data.detectedCommands.typecheck) typecheckInput.value = data.detectedCommands.typecheck;
      if (lintInput && !lintInput.value && data.detectedCommands.lint) lintInput.value = data.detectedCommands.lint;
    }
  } catch {
    if (pill) {
      pill.className = "status-pill pending";
      pill.textContent = "Pending Local Setup";
    }
  }
}

function createInspectionCard(r, wsRoot) {
  const localPath = r.path || `${wsRoot.replace(/\/+$/, "")}/${r.name}`;
  r.localPath = localPath;

  const card = document.createElement("div");
  card.className = "inspection-card";
  card.id = `inspect-card-${escapeHtml(r.name)}`;
  card.innerHTML = `
    <div class="inspection-header">
      <div>
        <strong style="font-size: 0.95rem;">${escapeHtml(r.name)}</strong>
        <span class="role-badge" style="margin-left: 0.4rem;">${escapeHtml(r.role || "other")}</span>
      </div>
      <span class="status-pill pending" id="inspect-pill-${escapeHtml(r.name)}">Inspecting…</span>
    </div>
    <div class="form-group" style="margin-bottom: 0.5rem;">
      <div class="label-with-tooltip">
        <label style="font-size: 0.75rem; font-weight: 600;">Local Path</label>
        <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Local Path">?
          <span class="tooltip-popover">
            <strong>Local Path</strong>
            Directory on your local machine where this repository checkout is located. X-Factory uses this folder to spawn isolated Git worktrees for tasks.
          </span>
        </span>
      </div>
      <input type="text" class="form-input code-input repo-path-input" data-repo="${escapeHtml(r.name)}" value="${escapeHtml(localPath)}">
    </div>
    <div class="inspection-commands-grid">
      <div>
        <div class="label-with-tooltip">
          <label style="font-size: 0.75rem; font-weight: 600;">Test Command</label>
          <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Test Command">?
            <span class="tooltip-popover">
              <strong>Test Command</strong>
              Command to run automated tests (e.g. <code>bun test</code>, <code>npm test</code>, <code>cargo test</code>). Used by Pi to verify solutions.
            </span>
          </span>
        </div>
        <input type="text" class="form-input code-input cmd-test" data-repo="${escapeHtml(r.name)}" placeholder="e.g. bun test" value="${escapeHtml(r.commands?.test || "")}">
      </div>
      <div>
        <div class="label-with-tooltip">
          <label style="font-size: 0.75rem; font-weight: 600;">Typecheck Command</label>
          <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Typecheck Command">?
            <span class="tooltip-popover">
              <strong>Typecheck Command</strong>
              Command to perform static type verification (e.g. <code>bunx tsc --noEmit</code>).
            </span>
          </span>
        </div>
        <input type="text" class="form-input code-input cmd-typecheck" data-repo="${escapeHtml(r.name)}" placeholder="e.g. bunx tsc --noEmit" value="${escapeHtml(r.commands?.typecheck || "")}">
      </div>
      <div>
        <div class="label-with-tooltip">
          <label style="font-size: 0.75rem; font-weight: 600;">Lint Command</label>
          <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Lint Command">?
            <span class="tooltip-popover">
              <strong>Lint Command</strong>
              Command to check code style and lint rules (e.g. <code>bunx eslint .</code>, <code>ruff check .</code>).
            </span>
          </span>
        </div>
        <input type="text" class="form-input code-input cmd-lint" data-repo="${escapeHtml(r.name)}" placeholder="e.g. bunx eslint ." value="${escapeHtml(r.commands?.lint || "")}">
      </div>
    </div>
  `;

  return card;
}

function renderInspectionStep() {
  const onboardInspectionList = $("#onboard-inspection-list");
  if (!onboardInspectionList) return;
  onboardInspectionList.innerHTML = `<div class="text-muted" style="padding: 1rem;">Inspecting local checkouts…</div>`;

  const wsRoot = getVal("onboard-workspace-path", "") || "~";
  const repos = Array.from(onboardState.selectedRepos.values());

  if (repos.length === 0) {
    onboardInspectionList.innerHTML = `<div class="empty-state"><p>No repositories selected. Please go back and select at least one.</p></div>`;
    return;
  }

  onboardInspectionList.innerHTML = "";

  for (const r of repos) {
    const card = createInspectionCard(r, wsRoot);
    onboardInspectionList.appendChild(card);
    inspectRepoAsync(r);
  }
}

function buildProjectConfigFromWizard() {
  const id = getVal("onboard-proj-id", "project").trim();
  const name = getVal("onboard-proj-name", id).trim();
  const workspacePath = getVal("onboard-workspace-path", "").trim() || undefined;
  const connectionId = getVal("onboard-tracker-connection", "azure");
  const trackerProj = getVal("onboard-tracker-project", "").trim() || undefined;
  const onboardInspectionList = $("#onboard-inspection-list");

  const repositories = [];
  const repoCards = onboardInspectionList ? onboardInspectionList.querySelectorAll(".inspection-card") : [];

  for (const card of repoCards) {
    const pathInput = card.querySelector(".repo-path-input");
    const testInput = card.querySelector(".cmd-test");
    const typecheckInput = card.querySelector(".cmd-typecheck");
    const lintInput = card.querySelector(".cmd-lint");

    const repoName = pathInput?.getAttribute("data-repo") || "";
    const repoPath = pathInput?.value.trim() || "";
    const original = onboardState.selectedRepos.get(repoName) || {};

    const commands = {};
    if (testInput?.value.trim()) commands.test = testInput.value.trim();
    if (typecheckInput?.value.trim()) commands.typecheck = typecheckInput.value.trim();
    if (lintInput?.value.trim()) commands.lint = lintInput.value.trim();

    repositories.push({
      id: original.id || repoName,
      name: repoName,
      path: repoPath,
      remote: original.remote || undefined,
      defaultBranch: original.defaultBranch || "main",
      role: original.role || "other",
      commands: Object.keys(commands).length > 0 ? commands : undefined,
    });
  }

  let knowledgeRepository = undefined;
  if (onboardState.knowledgeRepoId) {
    const kName = onboardState.knowledgeRepoId;
    const wsRoot = workspacePath || "~";
    knowledgeRepository = {
      repositoryId: kName,
      path: `${wsRoot.replace(/\/+$/, "")}/${kName}`,
      type: "graphify",
    };
  }

  return {
    id,
    name,
    workspacePath,
    issueTracker: {
      connectionId,
      projectId: trackerProj,
    },
    repositories,
    knowledgeRepository,
  };
}

function renderReviewStep() {
  const reviewJsonPreview = $("#review-json-preview");
  const config = buildProjectConfigFromWizard();
  if (reviewJsonPreview) {
    reviewJsonPreview.textContent = JSON.stringify(config, null, 2);
  }
}

function goToOnboardStep(step) {
  setOnboardError("");
  onboardState.step = step;

  $$(".step-indicator").forEach((el) => {
    const s = parseInt(el.getAttribute("data-step") || "1", 10);
    el.classList.toggle("active", s === step);
    el.classList.toggle("completed", s < step);
  });

  for (let i = 1; i <= 6; i++) {
    const pane = $(`#onboard-step-${i}`);
    if (pane) pane.hidden = i !== step;
  }

  const btnOnboardPrev = $("#btn-onboard-prev");
  const btnOnboardNext = $("#btn-onboard-next");
  const btnOnboardSave = $("#btn-onboard-save");

  if (btnOnboardPrev) btnOnboardPrev.disabled = step === 1;
  if (btnOnboardNext) {
    btnOnboardNext.hidden = step === 6;
    btnOnboardNext.style.display = step === 6 ? "none" : "inline-flex";
  }
  if (btnOnboardSave) {
    btnOnboardSave.hidden = step !== 6;
    btnOnboardSave.style.display = step === 6 ? "inline-flex" : "none";
  }

  if (step === 3) {
    updateDiscoveryFieldsVisibility();
  } else if (step === 4) {
    renderDiscoveredRepos();
  } else if (step === 5) {
    renderInspectionStep();
  } else if (step === 6) {
    renderReviewStep();
  }
}

const ROLE_KEYWORDS = [
  ["knowledge", "knowledge"],
  ["graph", "knowledge"],
  ["front", "frontend"],
  ["web", "frontend"],
  ["ui", "frontend"],
  ["api", "backend"],
  ["backend", "backend"],
  ["server", "backend"],
  ["worker", "worker"],
  ["infra", "infrastructure"],
];

function inferRepoRole(name) {
  const lower = name.toLowerCase();
  const match = ROLE_KEYWORDS.find(([kw]) => lower.includes(kw));
  return match ? match[1] : "other";
}

async function handleRunDiscovery() {
  setOnboardError("");
  const discSource = getVal("onboard-discovery-source", "local");
  const trackerProj = getVal("onboard-tracker-project", "");
  const primRepo = getVal("onboard-primary-repo", "");
  const wsPath = getVal("onboard-workspace-path", "");
  const azureOrgUrl = getVal("onboard-azure-org-url", "").trim();
  const azurePat = getVal("onboard-azure-pat", "").trim();
  const discoveryStatusText = $("#discovery-status-text");
  const btnRunDiscovery = $("#btn-run-discovery");

  if (discoveryStatusText) discoveryStatusText.textContent = "Discovering repositories…";
  if (btnRunDiscovery) btnRunDiscovery.disabled = true;

  try {
    const data = await api("POST", "/projects/discover-repositories", {
      provider: discSource,
      project: trackerProj,
      repoOwner: trackerProj,
      workspacePath: wsPath,
      primaryRepo: primRepo,
      orgUrl: azureOrgUrl,
      pat: azurePat,
    });

    const repos = data.repositories || [];
    onboardState.discovered = repos;
    onboardState.primaryRepo = primRepo;

    onboardState.selectedRepos.clear();
    for (const r of repos) {
      const isPrimary = primRepo && (r.name.toLowerCase() === primRepo.toLowerCase() || r.id === primRepo);
      const role = inferRepoRole(r.name);

      if (role !== "knowledge" || isPrimary) {
        onboardState.selectedRepos.set(r.name, {
          ...r,
          role,
          isPrimary: Boolean(isPrimary),
        });
      }
    }

    const kCandidate = repos.find((r) => r.name.toLowerCase().includes("knowledge") || r.name.toLowerCase().includes("graph"));
    if (kCandidate) {
      onboardState.knowledgeRepoId = kCandidate.name;
    }

    if (discoveryStatusText) discoveryStatusText.textContent = `Found ${repos.length} repositories.`;
    goToOnboardStep(4);
  } catch (err) {
    if (discoveryStatusText) discoveryStatusText.textContent = "Discovery failed.";
    setOnboardError(err instanceof Error ? err.message : String(err));
  } finally {
    if (btnRunDiscovery) btnRunDiscovery.disabled = false;
  }
}

function handlePrimaryRepoUrlInput(e) {
  const val = (e.target.value || "").trim();
  const azureMatch = val.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)/i);
  const vsMatch = val.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)/i);
  if (!azureMatch && !vsMatch) return;

  const orgUrl = azureMatch ? `https://dev.azure.com/${azureMatch[1]}` : `https://${vsMatch[1]}.visualstudio.com`;
  const proj = decodeURIComponent(azureMatch ? azureMatch[2] : vsMatch[2]);
  const onboardAzureOrgUrlInput = $("#onboard-azure-org-url");
  const onboardTrackerProj = $("#onboard-tracker-project");
  const onboardDiscoverySource = $("#onboard-discovery-source");

  if (onboardAzureOrgUrlInput && !onboardAzureOrgUrlInput.value) {
    onboardAzureOrgUrlInput.value = orgUrl;
  }
  if (onboardTrackerProj && !onboardTrackerProj.value) {
    onboardTrackerProj.value = proj;
  }
  if (onboardDiscoverySource && onboardDiscoverySource.value !== "azure") {
    onboardDiscoverySource.value = "azure";
    updateDiscoveryFieldsVisibility();
  }
}

function handleTrackerConnChange(e) {
  const tracker = e.target.value;
  const sourceSel = $("#onboard-discovery-source");
  const onboardTrackerProj = $("#onboard-tracker-project");
  const onboardTrackerHint = $("#onboard-tracker-hint");

  if (tracker === "jira") {
    if (onboardTrackerProj) onboardTrackerProj.placeholder = "e.g. VEND (Jira Project Key)";
    if (onboardTrackerHint) onboardTrackerHint.textContent = "Jira Software project key (used with JQL to find tickets).";
    if (sourceSel) sourceSel.value = "local";
  } else if (tracker === "github") {
    if (onboardTrackerProj) onboardTrackerProj.placeholder = "e.g. org/repo or org";
    if (onboardTrackerHint) onboardTrackerHint.textContent = "GitHub repository owner/repo or organization name.";
    if (sourceSel) sourceSel.value = "github";
  } else {
    if (onboardTrackerProj) onboardTrackerProj.placeholder = "e.g. VendifAI (Azure DevOps Project)";
    if (onboardTrackerHint) onboardTrackerHint.textContent = "Azure DevOps project name (used with WIQL queries).";
    if (sourceSel) sourceSel.value = "azure";
  }
  updateDiscoveryFieldsVisibility();
}

function handleOnboardNext() {
  setOnboardError("");
  if (onboardState.step === 1) {
    const name = getVal("onboard-proj-name", "").trim();
    const id = getVal("onboard-proj-id", "").trim();
    if (!name) return setOnboardError("Project Display Name is required.");
    if (!id) return setOnboardError("Stable Project Identifier is required.");
    goToOnboardStep(2);
  } else if (onboardState.step === 2) {
    goToOnboardStep(3);
  } else if (onboardState.step === 3) {
    if (onboardState.discovered.length === 0) {
      return setOnboardError("Please click 'Discover Repositories' to find repositories before continuing.");
    }
    goToOnboardStep(4);
  } else if (onboardState.step === 4) {
    if (onboardState.selectedRepos.size === 0) {
      return setOnboardError("Please select at least one application repository.");
    }
    goToOnboardStep(5);
  } else if (onboardState.step === 5) {
    goToOnboardStep(6);
  }
}

async function handleOnboardSave() {
  setOnboardError("");
  if (onboardState.step !== 6) {
    return setOnboardError("Please complete all wizard steps before saving.");
  }
  const btnOnboardSave = $("#btn-onboard-save");
  if (btnOnboardSave) {
    btnOnboardSave.disabled = true;
    btnOnboardSave.textContent = "Saving…";
  }

  try {
    const config = buildProjectConfigFromWizard();
    await api("POST", "/projects", config);
    await loadProjectsData();
    closeOnboardModal();
    openProjectDetail(config.id);
  } catch (err) {
    setOnboardError(err instanceof Error ? err.message : String(err));
  } finally {
    if (btnOnboardSave) {
      btnOnboardSave.disabled = false;
      btnOnboardSave.textContent = "Save Project";
    }
  }
}

export function initWizard() {
  const onboardNameInput = $("#onboard-proj-name");
  const onboardIdInput = $("#onboard-proj-id");
  if (onboardNameInput && onboardIdInput) {
    onboardNameInput.addEventListener("input", (e) => {
      setOnboardError("");
      if (!onboardIdInput.dataset.manual) {
        onboardIdInput.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      }
    });
    onboardIdInput.addEventListener("input", () => {
      setOnboardError("");
      onboardIdInput.dataset.manual = "true";
    });
  }

  const onboardDiscoverySource = $("#onboard-discovery-source");
  if (onboardDiscoverySource) {
    onboardDiscoverySource.addEventListener("change", updateDiscoveryFieldsVisibility);
  }

  const onboardPrimaryRepoInput = $("#onboard-primary-repo");
  if (onboardPrimaryRepoInput) {
    onboardPrimaryRepoInput.addEventListener("input", handlePrimaryRepoUrlInput);
  }

  const onboardTrackerConn = $("#onboard-tracker-connection");
  if (onboardTrackerConn) {
    onboardTrackerConn.addEventListener("change", handleTrackerConnChange);
  }

  const btnRunDiscovery = $("#btn-run-discovery");
  if (btnRunDiscovery) {
    btnRunDiscovery.addEventListener("click", handleRunDiscovery);
  }

  const onboardRepoSearch = $("#onboard-repo-search");
  if (onboardRepoSearch) {
    onboardRepoSearch.addEventListener("input", renderDiscoveredRepos);
  }

  const btnOnboardNext = $("#btn-onboard-next");
  if (btnOnboardNext) {
    btnOnboardNext.addEventListener("click", handleOnboardNext);
  }

  const btnOnboardPrev = $("#btn-onboard-prev");
  if (btnOnboardPrev) {
    btnOnboardPrev.addEventListener("click", () => {
      if (onboardState.step > 1) {
        goToOnboardStep(onboardState.step - 1);
      }
    });
  }

  const btnOnboardSave = $("#btn-onboard-save");
  if (btnOnboardSave) {
    btnOnboardSave.addEventListener("click", handleOnboardSave);
  }

  const btnSelectAll = $("#btn-select-all-repos");
  if (btnSelectAll) {
    btnSelectAll.addEventListener("click", () => {
      const repos = onboardState.discovered || [];
      for (const r of repos) {
        if (r.name !== onboardState.knowledgeRepoId) {
          const isPrimary = r.name.toLowerCase() === (onboardState.primaryRepo || "").toLowerCase();
          onboardState.selectedRepos.set(r.name, {
            ...r,
            role: onboardState.selectedRepos.get(r.name)?.role || "other",
            isPrimary,
          });
        }
      }
      renderDiscoveredRepos();
    });
  }

  const btnDeselectAll = $("#btn-deselect-all-repos");
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener("click", () => {
      onboardState.selectedRepos.clear();
      renderDiscoveredRepos();
    });
  }

  const btnOpenOnboardModal = $("#btn-open-onboard-modal");
  if (btnOpenOnboardModal) {
    btnOpenOnboardModal.addEventListener("click", openOnboardModal);
  }

  const btnCloseOnboardModal = $("#btn-close-onboard-modal");
  if (btnCloseOnboardModal) {
    btnCloseOnboardModal.addEventListener("click", closeOnboardModal);
  }

  const btnOnboardCancel = $("#btn-onboard-cancel");
  if (btnOnboardCancel) {
    btnOnboardCancel.addEventListener("click", closeOnboardModal);
  }

  const modalOnboard = $("#modal-project-onboarding");
  if (modalOnboard) {
    modalOnboard.addEventListener("click", (e) => {
      if (e.target === modalOnboard) {
        closeOnboardModal();
      }
    });
  }
}
