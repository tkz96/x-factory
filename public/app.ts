// public/app.ts — Clean application bootstrap orchestrator assembling native ES modules.

import {
  initProjects,
  loadProjectsData,
  openProjectDetail,
  renderProjectsList,
} from "./js/projects.js";
import { initQueue, loadWorkQueue, setOnSelectTicket } from "./js/queue.js";
import { handleHashChange, initRouter, setRouteHandlers } from "./js/router.js";
import {
  initRuns,
  loadHistory,
  refreshRunsList,
  syncRunsView,
  updateStartButton,
} from "./js/runs.js";
import { initSettings, initTheme, loadSettingsView } from "./js/settings.js";
import { initTooltips } from "./js/tooltips.js";
import { mountViews } from "./js/views/index.js";
import { initWizard, openOnboardModal } from "./js/wizard.js";
import { renderScopeDiagnostics } from "./js/wizard-render.js";

// Expose verification hook for live browser testing
if (typeof window !== "undefined") {
  (
    window as unknown as {
      renderScopeDiagnostics: typeof renderScopeDiagnostics;
    }
  ).renderScopeDiagnostics = renderScopeDiagnostics;
}

setRouteHandlers({
  queue: loadWorkQueue,
  runs: syncRunsView,
  history: loadHistory,
  projects: (subPath?: string) => {
    if (subPath) {
      void openProjectDetail(decodeURIComponent(subPath));
    } else {
      void renderProjectsList();
    }
  },
  settings: loadSettingsView,
});

setOnSelectTicket(() => {
  updateStartButton();
});

async function init(): Promise<void> {
  // Mount modular view templates into shell mount points
  mountViews();

  initTheme();
  initTooltips();
  initRouter();
  initProjects(openOnboardModal);
  initQueue();
  initRuns();
  initSettings();
  initWizard();

  await loadProjectsData();
  updateStartButton();
  refreshRunsList();
  handleHashChange();

  const params = new URLSearchParams(window.location.search);
  const testMode = params.get("testMode");
  if (testMode) {
    const modal = document.getElementById("modal-project-onboarding");
    if (modal) {
      modal.hidden = false;
      modal.style.animation = "none";
      modal.style.opacity = "1";
      const dialog = modal.querySelector<HTMLElement>(".modal-dialog");
      if (dialog) {
        dialog.style.animation = "none";
        dialog.style.opacity = "1";
        dialog.style.transform = "none";
        dialog.style.filter = "none";
      }
    }
    const step1 = document.getElementById("onboard-step-1");
    const step2 = document.getElementById("onboard-step-2");
    const step3 = document.getElementById("onboard-step-3");
    if (testMode === "modal-clean" || testMode === "modal-overprivileged") {
      if (step1) step1.hidden = true;
      if (step2) step2.hidden = false;
      const stepInd1 = document.querySelector(".step-indicator[data-step='1']");
      const stepInd2 = document.querySelector(".step-indicator[data-step='2']");
      if (stepInd1) stepInd1.className = "step-indicator completed";
      if (stepInd2) stepInd2.className = "step-indicator active";

      if (testMode === "modal-clean") {
        renderScopeDiagnostics({
          ok: true,
          overPrivileged: false,
          scopes: {
            workItemsRead: true,
            codeRead: true,
            codeStatus: true,
            workItemsWriteDetected: false,
            codeFullDetected: false,
          },
        });
      } else {
        renderScopeDiagnostics({
          ok: true,
          overPrivileged: true,
          scopes: {
            workItemsRead: true,
            codeRead: true,
            codeStatus: true,
            workItemsWriteDetected: true,
            codeFullDetected: false,
          },
          warnings: [
            "Work Items: Write permission detected. X-Factory operates in read-only mode for issues.",
          ],
        });
        document
          .getElementById("scope-overprivileged-warning")
          ?.scrollIntoView({ block: "center" });
      }
    } else if (testMode === "modal-step3") {
      if (step1) step1.hidden = true;
      if (step2) step2.hidden = true;
      if (step3) step3.hidden = false;
      const stepInd1 = document.querySelector(".step-indicator[data-step='1']");
      const stepInd2 = document.querySelector(".step-indicator[data-step='2']");
      const stepInd3 = document.querySelector(".step-indicator[data-step='3']");
      if (stepInd1) stepInd1.className = "step-indicator completed";
      if (stepInd2) stepInd2.className = "step-indicator completed";
      if (stepInd3) stepInd3.className = "step-indicator active";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
