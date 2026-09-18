// public/js/wizard.ts — Lean project onboarding wizard orchestrator (< 400 lines).

import type { RepositoryRole } from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { $, $$, getVal, setVal } from "./utils.js";
import {
  checkWorkspacePath,
  handleOnboardSave,
  handleRunDiscovery,
  handleTestTrackerConnection,
  inspectRepoAsync,
} from "./wizard-actions.js";
import {
  createInspectionCard,
  renderDiscoveredReposList,
  renderReviewStepContent,
  updateDiscoveryFieldsVisibility,
  updateTrackerFieldsVisibility,
} from "./wizard-render.js";
import {
  buildProjectConfig,
  WizardStateMachine,
  type WizardStep,
} from "./wizard-state.js";
import { parseQuickUrl } from "./wizard-url.js";

const sm = new WizardStateMachine();
let pathCheckTimeout: ReturnType<typeof setTimeout> | undefined;

function setOnboardError(msg: string): void {
  sm.setError(msg);
  const box = $<HTMLElement>("#onboard-error-box");
  if (!box) return;
  box.textContent = msg;
  box.hidden = !msg;
}

export function openOnboardModal(): void {
  sm.reset();
  setOnboardError("");
  const modal = $<HTMLElement>("#modal-project-onboarding");
  if (modal) modal.hidden = false;

  const quickUrl = $<HTMLInputElement>("#onboard-quick-url");
  if (quickUrl) {
    quickUrl.value = "";
    quickUrl.focus();
  }
  const feedback = $<HTMLElement>("#quick-url-feedback");
  if (feedback) feedback.hidden = true;

  goToOnboardStep(1);
}

function closeOnboardModal(): void {
  const modal = $<HTMLElement>("#modal-project-onboarding");
  if (modal) modal.hidden = true;
  setOnboardError("");
}

function autoPopulateBasics(projectName: string): void {
  const nameInput = $<HTMLInputElement>("#onboard-proj-name");
  const idInput = $<HTMLInputElement>("#onboard-proj-id");
  const wsInput = $<HTMLInputElement>("#onboard-workspace-path");

  if (nameInput) {
    nameInput.value = projectName;
    sm.update({ projectName });
  }
  if (idInput && !idInput.dataset.manual) {
    const autoId = projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    idInput.value = autoId;
    sm.update({ projectId: autoId });
  }
  if (wsInput && !wsInput.value) {
    wsInput.value = "/Users/talhazuberi/projects";
    sm.update({ workspacePath: wsInput.value });
    void checkWorkspacePath(wsInput.value);
  }
}

function applyParsedUrl(val: string): boolean {
  const parsed = parseQuickUrl(val);
  if (!parsed) return false;

  if (parsed.provider === "azure") {
    autoPopulateBasics(parsed.project);
    setVal("onboard-tracker-connection", "azure");
    setVal("onboard-tracker-project", parsed.project);
    setVal("onboard-azure-org-url-step2", parsed.orgUrl);
    setVal("onboard-primary-repo", parsed.project);
    setVal("onboard-discovery-source", "azure");
    setVal("onboard-azure-org-url", parsed.orgUrl);
    sm.update({
      tracker: "azure",
      trackerProject: parsed.project,
      trackerOrgUrl: parsed.orgUrl,
      discoverySource: "azure",
      primaryRepo: parsed.project,
    });
  } else {
    autoPopulateBasics(parsed.repo);
    setVal("onboard-tracker-connection", "github");
    setVal("onboard-tracker-project", `${parsed.owner}/${parsed.repo}`);
    setVal("onboard-primary-repo", parsed.repo);
    setVal("onboard-discovery-source", "github");
    sm.update({
      tracker: "github",
      trackerProject: `${parsed.owner}/${parsed.repo}`,
      discoverySource: "github",
      primaryRepo: parsed.repo,
    });
  }
  updateTrackerFieldsVisibility(sm.getState().tracker);
  updateDiscoveryFieldsVisibility(sm.getState().discoverySource);
  return true;
}

function handleQuickUrlInput(e: Event): void {
  const val = ((e.target as HTMLInputElement).value || "").trim();
  const feedback = $<HTMLElement>("#quick-url-feedback");
  if (!val) {
    if (feedback) feedback.hidden = true;
    return;
  }

  const success = applyParsedUrl(val);
  if (feedback) {
    feedback.hidden = false;
    clearElement(feedback);
    if (success) {
      feedback.className = "quick-url-feedback quick-url-success";
      feedback.appendChild(
        el("div", {}, [
          el("strong", {
            style: { color: "var(--green)" },
            textContent: "✓ URL Detected",
          }),
          document.createTextNode(" — Fields auto-populated."),
        ]),
      );
    } else {
      feedback.className = "quick-url-feedback quick-url-tip";
      feedback.appendChild(
        el("span", {}, [
          "Tip: Enter a valid Azure DevOps project URL or GitHub URL.",
        ]),
      );
    }
  }
}

function renderDiscoveredRepos(): void {
  const q = getVal("onboard-repo-search").toLowerCase().trim();
  renderDiscoveredReposList(
    sm.getState(),
    q,
    (name, role) => {
      sm.update({ primaryRepo: name });
      setVal("onboard-primary-repo", name);
      if (!sm.getState().selectedRepos.has(name)) {
        sm.getState().selectedRepos.set(name, { name, role, isPrimary: true });
      }
      renderDiscoveredRepos();
    },
    (name, checked, role, isPrimary) => {
      if (checked) {
        sm.getState().selectedRepos.set(name, { name, role, isPrimary });
      } else {
        sm.getState().selectedRepos.delete(name);
      }
      renderDiscoveredRepos();
    },
    (name, newRole: RepositoryRole) => {
      const existing = sm.getState().selectedRepos.get(name);
      if (existing) existing.role = newRole;
    },
  );
}

function renderInspectionStep(): void {
  const list = $<HTMLElement>("#onboard-inspection-list");
  if (!list) return;
  const s = sm.getState();

  clearElement(list);
  if (s.selectedRepos.size === 0) {
    list.appendChild(
      el("div", { className: "empty-state" }, [
        el("p", {
          textContent: "No repositories selected. Please select at least one.",
        }),
      ]),
    );
    return;
  }

  for (const repo of s.selectedRepos.values()) {
    list.appendChild(
      createInspectionCard(
        repo,
        s.workspacePath,
        (newPath) => {
          repo.path = newPath;
        },
        (cmdType, val) => {
          repo.commands = repo.commands || {};
          repo.commands[cmdType] = val || undefined;
        },
      ),
    );
    void inspectRepoAsync(sm, repo);
  }
}

function updateStepButtons(step: WizardStep): void {
  const btnPrev = $<HTMLButtonElement>("#btn-onboard-prev");
  const btnNext = $<HTMLButtonElement>("#btn-onboard-next");
  const btnSave = $<HTMLButtonElement>("#btn-onboard-save");

  if (btnPrev) btnPrev.disabled = step === 1;
  if (btnNext) {
    btnNext.hidden = step === 6;
    btnNext.style.display = step === 6 ? "none" : "inline-flex";
  }
  if (btnSave) {
    btnSave.hidden = step !== 6;
    btnSave.style.display = step === 6 ? "inline-flex" : "none";
  }
}

function goToOnboardStep(step: WizardStep): void {
  if (!sm.transitionTo(step)) return;
  setOnboardError("");

  const s = sm.getState();
  $$<HTMLElement>(".step-indicator").forEach((elStep) => {
    const stepNum = parseInt(elStep.getAttribute("data-step") || "1", 10);
    elStep.classList.toggle("active", stepNum === step);
    elStep.classList.toggle("completed", stepNum < step);
    elStep.style.cursor = stepNum <= s.maxStepReached ? "pointer" : "default";
  });

  for (let i = 1; i <= 6; i++) {
    const pane = $<HTMLElement>(`#onboard-step-${i}`);
    if (pane) pane.hidden = i !== step;
  }

  updateStepButtons(step);
  if (step === 2) updateTrackerFieldsVisibility(s.tracker);
  if (step === 3) updateDiscoveryFieldsVisibility(s.discoverySource);
  if (step === 4) renderDiscoveredRepos();
  if (step === 5) renderInspectionStep();
  if (step === 6)
    renderReviewStepContent(
      buildProjectConfig(s),
      s.primaryRepo,
      s.knowledgeRepoId,
    );
}

function handleOnboardNext(): void {
  setOnboardError("");
  const s = sm.getState();
  if (s.step === 1) {
    const name = getVal("onboard-proj-name").trim();
    const id = getVal("onboard-proj-id").trim();
    const ws = getVal("onboard-workspace-path").trim();
    if (!name) {
      setOnboardError("Project Display Name is required.");
      return;
    }
    if (!id) {
      setOnboardError("Stable Project Identifier is required.");
      return;
    }
    sm.update({ projectName: name, projectId: id, workspacePath: ws });
    goToOnboardStep(2);
  } else if (s.step === 2) {
    const tracker = getVal("onboard-tracker-connection", "azure");
    const gitHost = getVal("onboard-git-host", "azure");
    const trackerProject = getVal("onboard-tracker-project").trim();
    const trackerOrgUrl = getVal("onboard-azure-org-url-step2").trim();
    const trackerPat = getVal("onboard-azure-pat-step2").trim();
    const trackerHost = getVal("onboard-jira-host").trim();
    const trackerEmail = getVal("onboard-jira-email").trim();
    const trackerToken =
      tracker === "jira"
        ? getVal("onboard-jira-token").trim()
        : getVal("onboard-github-token").trim();

    if (tracker === "azure") {
      if (!trackerOrgUrl) {
        setOnboardError("Azure Organization URL is required.");
        return;
      }
      if (!trackerProject) {
        setOnboardError("Azure Project Name is required.");
        return;
      }
      if (trackerPat) {
        if (!s.patScopeResult) {
          setOnboardError(
            "Please click 'Test Connection' to verify required least-privilege scopes for your Azure PAT before proceeding.",
          );
          return;
        }
        if (!s.patScopeResult.ok) {
          setOnboardError(
            `Missing required scopes: ${s.patScopeResult.errors?.join(" ") || "Invalid scopes detected"}. Please update your PAT in Azure DevOps before continuing.`,
          );
          return;
        }
        if (s.patScopeResult.overPrivileged) {
          const ack = $<HTMLInputElement>("#chk-pat-least-privilege-ack");
          if (ack && !ack.checked) {
            setOnboardError(
              "Please check 'I understand' to acknowledge this token's permissions before continuing.",
            );
            return;
          }
        }
      }
    } else if (tracker === "jira") {
      if (!trackerHost) {
        setOnboardError("Jira Host URL is required.");
        return;
      }
      if (!trackerEmail) {
        setOnboardError("Jira Email is required.");
        return;
      }
      if (!trackerProject) {
        setOnboardError("Jira Project Key is required.");
        return;
      }
      if (!trackerToken) {
        setOnboardError("Jira API Token is required.");
        return;
      }
    } else if (tracker === "github") {
      if (!trackerProject) {
        setOnboardError("GitHub Repository (owner/repo) is required.");
        return;
      }
    }

    sm.update({
      tracker,
      gitHost,
      trackerProject,
      trackerOrgUrl,
      trackerPat,
      trackerHost,
      trackerEmail,
      trackerToken,
    });
    goToOnboardStep(3);
  } else if (s.step === 3) {
    if (s.discovered.length === 0) {
      setOnboardError(
        "Please click 'Discover Repositories' before continuing.",
      );
      return;
    }
    goToOnboardStep(4);
  } else if (s.step === 4) {
    if (s.selectedRepos.size === 0) {
      setOnboardError("Please select at least one application repository.");
      return;
    }
    goToOnboardStep(5);
  } else if (s.step === 5) {
    goToOnboardStep(6);
  }
}

function bindWizardInputs(): void {
  const quickUrl = $<HTMLInputElement>("#onboard-quick-url");
  if (quickUrl) quickUrl.addEventListener("input", handleQuickUrlInput);

  const trackerConn = $<HTMLSelectElement>("#onboard-tracker-connection");
  if (trackerConn) {
    trackerConn.addEventListener("change", (e: Event) => {
      const val = (e.target as HTMLSelectElement).value;
      sm.update({ tracker: val });
      updateTrackerFieldsVisibility(val);
    });
  }

  const gitHostSelect = $<HTMLSelectElement>("#onboard-git-host");
  if (gitHostSelect) {
    gitHostSelect.addEventListener("change", (e: Event) => {
      const val = (e.target as HTMLSelectElement).value;
      sm.update({ gitHost: val });
    });
  }

  const patInput = $<HTMLInputElement>("#onboard-azure-pat-step2");
  if (patInput) {
    patInput.addEventListener("input", () => {
      sm.update({ patScopeResult: undefined });
      const card = $<HTMLElement>("#azure-scope-diagnostic-card");
      if (card) card.hidden = true;
      const resultBox =
        $<HTMLElement>("#tracker-test-result") ||
        $<HTMLElement>("#tracker-test-status");
      if (resultBox) {
        resultBox.textContent = "";
        resultBox.className = "tracker-test-status";
      }
    });
  }

  const discoverySource = $<HTMLSelectElement>("#onboard-discovery-source");
  if (discoverySource) {
    discoverySource.addEventListener("change", (e: Event) => {
      const val = (e.target as HTMLSelectElement).value;
      sm.update({ discoverySource: val });
      updateDiscoveryFieldsVisibility(val);
    });
  }

  const wsInput = $<HTMLInputElement>("#onboard-workspace-path");
  if (wsInput) {
    wsInput.addEventListener("input", (e: Event) => {
      clearTimeout(pathCheckTimeout);
      pathCheckTimeout = setTimeout(() => {
        void checkWorkspacePath((e.target as HTMLInputElement).value);
      }, 350);
    });
  }

  const btnTest = $<HTMLButtonElement>("#btn-test-tracker-connection");
  if (btnTest) {
    btnTest.addEventListener("click", () => {
      void handleTestTrackerConnection(sm);
    });
  }

  const btnDiscover = $<HTMLButtonElement>("#btn-run-discovery");
  if (btnDiscover) {
    btnDiscover.addEventListener("click", () => {
      void handleRunDiscovery(sm, renderDiscoveredRepos);
    });
  }
}

function bindWizardNavButtons(): void {
  const btnNext = $<HTMLButtonElement>("#btn-onboard-next");
  if (btnNext) btnNext.addEventListener("click", handleOnboardNext);

  const btnPrev = $<HTMLButtonElement>("#btn-onboard-prev");
  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      const cur = sm.getState().step;
      if (cur > 1) goToOnboardStep((cur - 1) as WizardStep);
    });
  }

  const btnSave = $<HTMLButtonElement>("#btn-onboard-save");
  if (btnSave) {
    btnSave.addEventListener("click", () => {
      void handleOnboardSave(sm, closeOnboardModal, setOnboardError);
    });
  }

  $$<HTMLElement>(".step-indicator").forEach((elStep) => {
    elStep.addEventListener("click", () => {
      const s = parseInt(elStep.getAttribute("data-step") || "1", 10);
      if (s >= 1 && s <= 6) goToOnboardStep(s as WizardStep);
    });
  });

  const btnOpen = $<HTMLButtonElement>("#btn-open-onboard-modal");
  if (btnOpen) btnOpen.addEventListener("click", openOnboardModal);

  const btnClose = $<HTMLButtonElement>("#btn-close-onboard-modal");
  if (btnClose) btnClose.addEventListener("click", closeOnboardModal);

  const btnCancel = $<HTMLButtonElement>("#btn-onboard-cancel");
  if (btnCancel) btnCancel.addEventListener("click", closeOnboardModal);

  const modalOnboard = $<HTMLElement>("#modal-project-onboarding");
  if (modalOnboard) {
    modalOnboard.addEventListener("click", (e) => {
      if (e.target === modalOnboard) closeOnboardModal();
    });
  }
}

export function initWizard(): void {
  bindWizardInputs();
  bindWizardNavButtons();
}
