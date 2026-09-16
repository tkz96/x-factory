// public/js/settings.ts — Global workbench preferences, connections registry, and Apple dark/light theme toggle.

import type { Project, WorkbenchSettings } from "../../src/shared/types.js";
import { $, $$, api, getVal, setVal } from "./utils.js";
import { openOnboardModal } from "./wizard.js";

function updateThemeSegmentButtons(): void {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const btnLight = $<HTMLElement>("#btn-theme-light");
  const btnDark = $<HTMLElement>("#btn-theme-dark");
  if (btnLight) btnLight.classList.toggle("active", current === "light");
  if (btnDark) btnDark.classList.toggle("active", current === "dark");
}

export function applyTheme(next: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("xf_theme", next);
  updateThemeSegmentButtons();
  api("POST", "/settings", { theme: next }).catch(() => {});
}

export function initTheme(): void {
  const saved = localStorage.getItem("xf_theme");
  const prefersLight = window.matchMedia?.(
    "(prefers-color-scheme: light)",
  ).matches;
  const theme = (saved || (prefersLight ? "light" : "dark")) as
    | "light"
    | "dark";
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeSegmentButtons();

  const toggles = $$<HTMLElement>("#theme-toggle, #theme-toggle-mobile");
  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const current =
        document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  });

  const btnLight = $<HTMLElement>("#btn-theme-light");
  const btnDark = $<HTMLElement>("#btn-theme-dark");
  if (btnLight) {
    btnLight.addEventListener("click", () => applyTheme("light"));
  }
  if (btnDark) {
    btnDark.addEventListener("click", () => applyTheme("dark"));
  }
}

async function renderConnectionsRegistry(): Promise<void> {
  const tbody = $<HTMLTableSectionElement>("#connections-registry-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="padding: 1rem; text-align: center;" class="text-muted">Loading connections...</td></tr>`;

  try {
    const projects = await api<Project[]>(
      "GET",
      "/projects?includeArchived=true",
    );
    if (!projects || projects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 1rem; text-align: center;" class="text-muted">No projects configured.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    for (const p of projects) {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border)";

      const provider =
        p.issueTracker?.provider || p.issueTracker?.connectionId || "github";
      let target = "";
      if (provider === "azure") {
        target = `${p.issueTracker?.azure?.orgUrl || ""} / ${p.issueTracker?.azure?.project || p.issueTracker?.projectId || ""}`;
      } else if (provider === "jira") {
        target = `${p.issueTracker?.jira?.host || ""} (${p.issueTracker?.jira?.project || ""})`;
      } else {
        target = p.issueTracker?.github?.repo || p.repositoryPath || "";
      }

      const isArchived = Boolean(p.archived);
      const statusBadge = isArchived
        ? `<span class="badge" style="padding: 2px 6px; font-size: var(--text-caption-2); border-radius: var(--radius-sm); font-family: var(--font-mono); background: var(--bg-tertiary); color: var(--text-muted);">Archived</span>`
        : `<span class="badge" style="padding: 2px 6px; font-size: var(--text-caption-2); border-radius: var(--radius-sm); font-family: var(--font-mono); background: var(--green-dim); color: var(--green);">Active</span>`;

      const providerBadge = `<span class="badge" style="padding: 2px 6px; font-size: var(--text-caption-2); border-radius: var(--radius-sm); font-family: var(--font-mono); text-transform: uppercase; background: var(--bg-tertiary); font-weight: 600;">${provider}</span>`;

      tr.innerHTML = `
        <td style="padding: 0.75rem 0.5rem; font-weight: 500;">
          ${p.name}
          ${p.predecessorId ? `<span class="text-muted" style="font-size: var(--text-caption-2); display: block;">from ${p.predecessorId}</span>` : ""}
        </td>
        <td style="padding: 0.75rem 0.5rem;">${providerBadge}</td>
        <td style="padding: 0.75rem 0.5rem; font-family: var(--font-mono); font-size: var(--text-callout);" class="text-muted">${target}</td>
        <td style="padding: 0.75rem 0.5rem;">${statusBadge}</td>
        <td style="padding: 0.75rem 0.5rem; text-align: right;">
          <a href="#/projects/${encodeURIComponent(p.id)}" class="btn-link" style="color: var(--accent); text-decoration: none; font-size: var(--text-callout); font-weight: 500;">View Project →</a>
        </td>
      `;

      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding: 1rem; text-align: center; color: var(--red);">Failed to load connections: ${err instanceof Error ? err.message : String(err)}</td></tr>`;
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
    updateThemeSegmentButtons();
    populateModelFields(s);
    void renderConnectionsRegistry();
  } catch (err) {
    if (settingsStatus) {
      settingsStatus.textContent = `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function buildSettingsPayload(): Record<string, unknown> {
  return {
    theme: document.documentElement.getAttribute("data-theme") || "dark",
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
        if (tabName === "trackers") {
          void renderConnectionsRegistry();
        }
      }
    });
  });

  const btnSaveSettings = $<HTMLButtonElement>("#btn-save-settings");
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      void saveSettingsView();
    });
  }

  const btnSettingsOnboard = $<HTMLButtonElement>(
    "#btn-settings-onboard-project",
  );
  if (btnSettingsOnboard) {
    btnSettingsOnboard.addEventListener("click", () => {
      openOnboardModal();
    });
  }
}
