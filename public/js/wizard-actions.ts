// public/js/wizard-actions.ts — Async action handlers for discovery, testing, and repo inspection in wizard.

import type { RepositoryRole } from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { loadProjectsData, openProjectDetail } from "./projects.js";
import { $, api, getVal } from "./utils.js";
import {
  checkWorkspacePathApi,
  inspectRepoApi,
  runDiscoveryApi,
  testTrackerConnectionApi,
} from "./wizard-api.js";
import {
  buildProjectConfig,
  type SelectedWizardRepo,
  type WizardStateMachine,
} from "./wizard-state.js";
import { inferRepoRole } from "./wizard-url.js";

export async function checkWorkspacePath(targetPath: string): Promise<void> {
  const box = $<HTMLElement>("#workspace-path-feedback");
  if (!box) return;
  const trimmed = targetPath.trim();
  if (!trimmed) {
    box.hidden = true;
    clearElement(box);
    return;
  }
  box.hidden = false;
  clearElement(box);
  box.appendChild(
    el("span", {
      style: { opacity: "0.75" },
      textContent: "Verifying local folder…",
    }),
  );

  try {
    const res = await checkWorkspacePathApi(trimmed);
    clearElement(box);
    const exists = Boolean(
      res.existsLocally ?? (res as { exists?: boolean }).exists,
    );
    if (exists) {
      box.appendChild(document.createTextNode("✓ Directory verified: "));
      box.appendChild(el("code", { textContent: res.resolvedPath }));
    } else {
      box.appendChild(
        el("span", { textContent: "⚠ Directory does not exist yet locally." }),
      );
    }
  } catch (err) {
    clearElement(box);
    box.appendChild(
      el("span", {
        textContent: `✗ Error: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

export async function handleTestTrackerConnection(): Promise<void> {
  const btn = $<HTMLButtonElement>("#btn-test-tracker-connection");
  const resultBox =
    $<HTMLElement>("#tracker-test-result") ||
    $<HTMLElement>("#tracker-test-status");
  if (!resultBox) return;

  resultBox.hidden = false;
  resultBox.className = "connection-result testing";
  resultBox.textContent = "Testing connection…";
  if (btn) btn.disabled = true;

  try {
    const provider = getVal("onboard-tracker-connection", "azure");
    const payload: {
      provider: string;
      orgUrl?: string;
      project?: string;
      pat?: string;
      host?: string;
      email?: string;
      token?: string;
      repo?: string;
    } = { provider };
    if (provider === "azure") {
      payload.orgUrl = getVal("onboard-azure-org-url-step2");
      payload.project = getVal("onboard-tracker-project");
      payload.pat = getVal("onboard-azure-pat-step2");
    } else if (provider === "jira") {
      payload.host = getVal("onboard-jira-host");
      payload.email = getVal("onboard-jira-email");
      payload.token = getVal("onboard-jira-token");
      payload.project = getVal("onboard-tracker-project");
    } else if (provider === "github") {
      payload.project = getVal("onboard-tracker-project");
      payload.repo = getVal("onboard-tracker-project");
      payload.token = getVal("onboard-github-token");
    }

    const res = await testTrackerConnectionApi(payload);
    resultBox.className = res.ok
      ? "connection-result success"
      : "connection-result error";
    resultBox.textContent = res.ok
      ? res.message ||
        `✓ Connected successfully. Found ${(res.repositories || []).length} repositories.`
      : `✗ Connection failed: ${res.error || "Unknown error"}`;
  } catch (err) {
    resultBox.className = "connection-result error";
    resultBox.textContent = `✗ Connection error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleRunDiscovery(
  sm: WizardStateMachine,
  onDone?: () => void,
): Promise<void> {
  const btn = $<HTMLButtonElement>("#btn-run-discovery");
  const statusEl =
    $<HTMLElement>("#discovery-status-text") ||
    $<HTMLElement>("#discovery-status");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Discovering repositories…";

  try {
    const repos = await runDiscoveryApi({
      provider: getVal("onboard-discovery-source", "local"),
      workspacePath: getVal("onboard-workspace-path"),
      orgUrl: getVal("onboard-azure-org-url"),
      project: getVal("onboard-tracker-project"),
      pat: getVal("onboard-azure-pat"),
    });
    sm.update({ discovered: repos || [] });

    const selected = new Map<string, SelectedWizardRepo>();
    for (const r of repos) {
      selected.set(r.name, {
        ...r,
        role: inferRepoRole(r.name) as RepositoryRole,
        isPrimary: r.name === sm.getState().primaryRepo,
      });
    }
    sm.update({ selectedRepos: selected });

    if (statusEl) {
      statusEl.textContent = `✓ Discovered ${repos.length} repositories.`;
    }
    if (onDone) onDone();
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `✗ Discovery failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function inspectRepoAsync(
  sm: WizardStateMachine,
  repo: SelectedWizardRepo,
): Promise<void> {
  const s = sm.getState();
  const pill = $(`#inspect-pill-${repo.name}`);
  const targetPath =
    repo.path || `${s.workspacePath.replace(/\/+$/, "")}/${repo.name}`;

  try {
    const res = await inspectRepoApi(targetPath, repo.name);
    if (pill) {
      pill.className =
        res.readiness.status === "ready"
          ? "status-pill ready"
          : "status-pill pending";
      pill.textContent =
        res.readiness.status === "ready"
          ? "✓ Ready"
          : res.readiness.message || "Pending Local Setup";
    }
  } catch {
    if (pill) {
      pill.className = "status-pill pending";
      pill.textContent = "Pending Local Setup";
    }
  }
}

export async function handleOnboardSave(
  sm: WizardStateMachine,
  onSuccess: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  onError("");
  const btnSave = $<HTMLButtonElement>("#btn-onboard-save");
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = "Saving…";
  }

  try {
    const state = sm.getState();
    const config = buildProjectConfig(state);
    await api("POST", "/projects", config);

    const provider = state.tracker || "azure";
    let secret = "";
    if (provider === "azure") {
      secret = getVal("onboard-azure-pat-step2") || getVal("onboard-azure-pat");
    } else if (provider === "jira") {
      secret = getVal("onboard-jira-token");
    } else if (provider === "github") {
      secret = getVal("onboard-github-token");
    }

    if (secret?.trim()) {
      try {
        await api("PUT", `/projects/${config.id}/tracker/credentials`, {
          secret: secret.trim(),
        });
      } catch (e) {
        console.warn("Could not save tracker credentials to project env:", e);
      }
    }

    await loadProjectsData();
    onSuccess();
    void openProjectDetail(config.id);
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "Save Project";
    }
  }
}
