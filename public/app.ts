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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
