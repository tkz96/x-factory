// fallow-ignore-file coverage-gaps
// public/js/router.js — Hash-based navigation, active area management, and view routing.

import { $, $$, hideError } from "./utils.js";

const AREA_METADATA = {
  queue: { title: "Work Queue", subtitle: "Tickets ready for agentic implementation" },
  runs: { title: "Active Runs", subtitle: "Live execution and verification workbench" },
  history: { title: "Run History", subtitle: "Previous factory runs and results" },
  projects: { title: "Projects", subtitle: "Codebases configured for factory automation" },
  settings: { title: "Settings", subtitle: "Issue trackers, model runtime, and workspace settings" },
};

const routeHandlers = {
  queue: () => {},
  runs: () => {},
  history: () => {},
  projects: () => {},
  settings: () => {},
};

export function setRouteHandlers(handlers) {
  Object.assign(routeHandlers, handlers);
}

function navigate(areaName) {
  const area = AREA_METADATA[areaName] ? areaName : "queue";

  $$(".sidebar-nav .nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.area === area);
  });

  $$(".area-view").forEach((el) => {
    el.classList.toggle("active", el.id === `area-${area}`);
  });

  const toolbarTitle = $("#toolbar-title");
  const toolbarSubtitle = $("#toolbar-subtitle");
  if (toolbarTitle && AREA_METADATA[area]) {
    toolbarTitle.textContent = AREA_METADATA[area].title;
    toolbarSubtitle.textContent = AREA_METADATA[area].subtitle;
  }

  if (routeHandlers[area]) {
    routeHandlers[area]();
  }
}

export function handleHashChange() {
  const hash = window.location.hash.replace(/^#\/?/, "") || "queue";
  navigate(hash);
}

export function openNewRunModal() {
  const modalNewRun = $("#modal-new-run");
  const inputTicketId = $("#input-ticket-id");
  if (modalNewRun) modalNewRun.hidden = false;
  if (inputTicketId) inputTicketId.focus();
}

export function closeNewRunModal() {
  const modalNewRun = $("#modal-new-run");
  const setupError = $("#setup-error");
  if (modalNewRun) modalNewRun.hidden = true;
  hideError(setupError);
}

export function showView(view) {
  const viewSetup = $("#view-setup");
  const viewRun = $("#view-run");
  const viewResult = $("#view-result");
  const runsStandby = $("#runs-standby");
  const workflowStepper = $("#workflow-stepper");

  if (view === viewSetup) {
    openNewRunModal();
  } else if (view === viewRun) {
    window.location.hash = "#/runs";
    if (runsStandby) runsStandby.hidden = true;
    if (workflowStepper) workflowStepper.style.display = "block";
    if (viewRun) viewRun.style.display = "block";
    if (viewResult) viewResult.style.display = "none";
  } else if (view === viewResult) {
    window.location.hash = "#/runs";
    if (runsStandby) runsStandby.hidden = true;
    if (viewRun) viewRun.style.display = "none";
    if (viewResult) viewResult.style.display = "block";
  }
}

export function initRouter() {
  window.addEventListener("hashchange", handleHashChange);

  const btnOpenNewRun = $("#btn-open-new-run");
  const btnQueueManual = $("#btn-queue-manual");
  const btnRunsStart = $("#btn-runs-start");
  const btnCloseModal = $("#btn-close-modal");
  const btnCancelModal = $("#btn-cancel-modal");
  const modalNewRun = $("#modal-new-run");

  if (btnOpenNewRun) btnOpenNewRun.addEventListener("click", openNewRunModal);
  if (btnQueueManual) btnQueueManual.addEventListener("click", openNewRunModal);
  if (btnRunsStart) btnRunsStart.addEventListener("click", openNewRunModal);
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeNewRunModal);
  if (btnCancelModal) btnCancelModal.addEventListener("click", closeNewRunModal);

  if (modalNewRun) {
    modalNewRun.addEventListener("click", (e) => {
      if (e.target === modalNewRun) closeNewRunModal();
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalNewRun && !modalNewRun.hidden) {
      closeNewRunModal();
    }
  });
}
