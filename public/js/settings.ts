// public/js/settings.ts — Global workbench preferences, tracker credentials, and Apple dark/light theme toggle.

import type { WorkbenchSettings } from "../../src/shared/types.js";
import { $, $$, api, getVal, setVal } from "./utils.js";

export function initTheme(): void {
  const saved = localStorage.getItem("xf_theme");
  const prefersLight = window.matchMedia?.(
    "(prefers-color-scheme: light)",
  ).matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);

  const toggle = $<HTMLElement>("#theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current =
        document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("xf_theme", next);
      api("POST", "/settings", { theme: next }).catch(() => {});
    });
  }
}

function updateTrackerProviderVisibility(provider: string): void {
  const trackerGroupGithub = $<HTMLElement>("#tracker-group-github");
  const trackerGroupJira = $<HTMLElement>("#tracker-group-jira");
  const trackerGroupAzure = $<HTMLElement>("#tracker-group-azure");

  if (trackerGroupGithub) trackerGroupGithub.hidden = provider !== "github";
  if (trackerGroupJira) trackerGroupJira.hidden = provider !== "jira";
  if (trackerGroupAzure) trackerGroupAzure.hidden = provider !== "azure";
}

function populateTrackerFields(s: WorkbenchSettings): void {
  const gh = s.github || {};
  const jira = s.jira || {};
  const az = s.azure || {};
  const tracker = s.activeTracker || "github";

  setVal("#setting-tracker-provider", tracker);
  updateTrackerProviderVisibility(tracker);

  const fields: Record<string, string | undefined> = {
    "#setting-github-token": gh.token,
    "#setting-github-repo": gh.repo,
    "#setting-jira-host": jira.host,
    "#setting-jira-email": jira.email,
    "#setting-jira-token": jira.token,
    "#setting-jira-project": jira.project,
    "#setting-azure-org": az.orgUrl,
    "#setting-azure-project": az.project,
    "#setting-azure-pat": az.pat,
  };
  for (const [id, val] of Object.entries(fields)) {
    setVal(id, val);
  }
}

function populateModelFields(s: WorkbenchSettings): void {
  setVal(
    "#setting-model-a-provider",
    s.models?.sessionA?.provider || "anthropic",
  );
  setVal(
    "#setting-model-a-model",
    s.models?.sessionA?.model || "claude-3-7-sonnet",
  );
  setVal(
    "#setting-model-b-provider",
    s.models?.sessionB?.provider || "anthropic",
  );
  setVal(
    "#setting-model-b-model",
    s.models?.sessionB?.model || "claude-3-7-sonnet",
  );
}

export async function loadSettingsView(): Promise<void> {
  const settingsStatus = $<HTMLElement>("#settings-status");
  try {
    const s = await api<WorkbenchSettings>("GET", "/settings");
    if (!s) return;
    if (s.theme && !localStorage.getItem("xf_theme")) {
      document.documentElement.setAttribute("data-theme", s.theme);
      localStorage.setItem("xf_theme", s.theme);
    }
    populateTrackerFields(s);
    populateModelFields(s);
  } catch (err) {
    if (settingsStatus) {
      settingsStatus.textContent = `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function buildSettingsPayload(): Record<string, unknown> {
  return {
    theme: document.documentElement.getAttribute("data-theme") || "dark",
    activeTracker: getVal("#setting-tracker-provider", "github"),
    github: {
      token: getVal("#setting-github-token"),
      repo: getVal("#setting-github-repo"),
    },
    jira: {
      host: getVal("#setting-jira-host"),
      email: getVal("#setting-jira-email"),
      token: getVal("#setting-jira-token"),
      project: getVal("#setting-jira-project"),
    },
    azure: {
      orgUrl: getVal("#setting-azure-org"),
      project: getVal("#setting-azure-project"),
      pat: getVal("#setting-azure-pat"),
    },
    models: {
      sessionA: {
        provider: getVal("#setting-model-a-provider", "anthropic"),
        model: getVal("#setting-model-a-model", "claude-3-7-sonnet"),
      },
      sessionB: {
        provider: getVal("#setting-model-b-provider", "anthropic"),
        model: getVal("#setting-model-b-model", "claude-3-7-sonnet"),
      },
    },
  };
}

async function saveSettingsView(): Promise<void> {
  const btnSaveSettings = $<HTMLButtonElement>("#btn-save-settings");
  const settingsStatus = $<HTMLElement>("#settings-status");
  if (!btnSaveSettings) return;
  btnSaveSettings.disabled = true;
  if (settingsStatus) settingsStatus.textContent = "Saving…";

  try {
    const payload = buildSettingsPayload();
    await api("POST", "/settings", payload);
    if (settingsStatus) {
      settingsStatus.textContent = "✓ Settings saved";
      setTimeout(() => {
        if (
          settingsStatus &&
          settingsStatus.textContent === "✓ Settings saved"
        ) {
          settingsStatus.textContent = "";
        }
      }, 3000);
    }
  } catch (err) {
    if (settingsStatus) {
      settingsStatus.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } finally {
    btnSaveSettings.disabled = false;
  }
}

export function initSettings(): void {
  $$<HTMLElement>(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$<HTMLElement>(".settings-tab-btn").forEach((b) => {
        b.classList.remove("active");
      });
      $$<HTMLElement>(".settings-pane").forEach((p) => {
        p.classList.remove("active");
      });

      btn.classList.add("active");
      const tabName = btn.dataset.tab;
      if (tabName) {
        const pane = $(`#tab-${tabName}`);
        if (pane) pane.classList.add("active");
      }
    });
  });

  const settingTrackerProvider = $<HTMLSelectElement>(
    "#setting-tracker-provider",
  );
  if (settingTrackerProvider) {
    settingTrackerProvider.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLSelectElement;
      updateTrackerProviderVisibility(target.value);
    });
  }

  const btnSaveSettings = $<HTMLButtonElement>("#btn-save-settings");
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      void saveSettingsView();
    });
  }
}
