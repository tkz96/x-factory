// public/app.js — Clean application bootstrap orchestrator assembling native ES modules.

import {
  initProjects,
  loadProjectsData,
  renderProjectsList,
} from "./js/projects.js";
import { initQueue, loadWorkQueue, setOnSelectTicket } from "./js/queue.js";
import {
  handleHashChange,
  initRouter,
  setRouteHandlers,
  showView,
} from "./js/router.js";
import {
  initRuns,
  loadHistory,
  refreshRunsList,
  syncRunsView,
  updateStartButton,
} from "./js/runs.js";
import { initSettings, initTheme, loadSettingsView } from "./js/settings.js";
import { initTooltips } from "./js/tooltips.js";
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
