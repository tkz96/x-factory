// public/app.js — Clean application bootstrap orchestrator assembling native ES modules.

import { initTheme, initSettings, loadSettingsView } from "./js/settings.js";
import { initTooltips } from "./js/tooltips.js";
import { initRouter, setRouteHandlers, showView, handleHashChange } from "./js/router.js";
import { initProjects, loadProjectsData, renderProjectsList } from "./js/projects.js";
import { initQueue, loadWorkQueue, setOnSelectTicket } from "./js/queue.js";
import { initRuns, syncRunsView, refreshRunsList, loadHistory, updateStartButton } from "./js/runs.js";
import { initWizard, openOnboardModal } from "./js/wizard.js";

// Legacy test compatibility
window.showView = showView;

setRouteHandlers({
  queue: loadWorkQueue,
  runs: syncRunsView,
  history: loadHistory,
  projects: renderProjectsList,
  settings: loadSettingsView,
});

setOnSelectTicket(() => {
  updateStartButton();
});

async function init() {
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
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
