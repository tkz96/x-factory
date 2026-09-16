// public/js/router.ts — Hash-based navigation, active area management, and view routing.

import { $, $$, hideError } from "./utils.js";

export type AreaName = "queue" | "runs" | "history" | "projects" | "settings";

interface AreaInfo {
  title: string;
  subtitle: string;
}

const AREA_METADATA: Record<AreaName, AreaInfo> = {
  queue: {
    title: "Work Queue",
    subtitle: "Tickets ready for agentic implementation",
  },
  runs: {
    title: "Active Runs",
    subtitle: "Live execution and verification workbench",
  },
  history: {
    title: "Run History",
    subtitle: "Previous factory runs and results",
  },
  projects: {
    title: "Projects",
    subtitle: "Codebases configured for factory automation",
  },
  settings: {
    title: "Settings",
    subtitle: "Issue trackers, model runtime, and workspace settings",
  },
};

export type RouteHandler = (subPath?: string) => void | Promise<void>;

const routeHandlers: Record<AreaName, RouteHandler> = {
  queue: () => {},
  runs: () => {},
  history: () => {},
  projects: () => {},
  settings: () => {},
};

export function setRouteHandlers(
  handlers: Partial<Record<AreaName, RouteHandler>>,
): void {
  Object.assign(routeHandlers, handlers);
}

function navigate(rawRoute: string): void {
  const parts = rawRoute.split("/");
  const primary = parts[0] || "queue";
  const isKnownArea = (name: string): name is AreaName => name in AREA_METADATA;
  const area: AreaName = isKnownArea(primary) ? primary : "queue";
  const subPath = parts.slice(1).join("/");

  $$<HTMLElement>(".sidebar-nav .nav-item, .mobile-tab-bar .tab-item").forEach(
    (el) => {
      el.classList.toggle("active", el.dataset.area === area);
    },
  );

  $$<HTMLElement>(".area-view").forEach((el) => {
    el.classList.toggle("active", el.id === `area-${area}`);
  });

  const toolbarTitle = $<HTMLElement>("#toolbar-title");
  const toolbarSubtitle = $<HTMLElement>("#toolbar-subtitle");
  if (toolbarTitle && toolbarSubtitle && AREA_METADATA[area]) {
    toolbarTitle.textContent = AREA_METADATA[area].title;
    toolbarSubtitle.textContent = AREA_METADATA[area].subtitle;
  }

  const handler = routeHandlers[area];
  if (handler) {
    void handler(subPath);
  }
}

export function handleHashChange(): void {
  const hash = window.location.hash.replace(/^#\/?/, "") || "queue";
  navigate(hash);
}

export function openNewRunModal(): void {
  const modalNewRun = $<HTMLElement>("#modal-new-run");
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  if (modalNewRun) modalNewRun.hidden = false;
  if (inputTicketId) inputTicketId.focus();
}

export function closeNewRunModal(): void {
  const modalNewRun = $<HTMLElement>("#modal-new-run");
  const setupError = $<HTMLElement>("#setup-error");
  if (modalNewRun) modalNewRun.hidden = true;
  hideError(setupError);
}

export function initRouter(): void {
  window.addEventListener("hashchange", handleHashChange);

  const btnOpenNewRun = $<HTMLButtonElement>("#btn-open-new-run");
  const btnHistoryNewRun = $<HTMLButtonElement>("#btn-history-new-run");
  const btnQueueManual = $<HTMLButtonElement>("#btn-queue-manual");
  const btnRunsStart = $<HTMLButtonElement>("#btn-runs-start");
  const btnCloseModal = $<HTMLButtonElement>("#btn-close-modal");
  const btnCancelModal = $<HTMLButtonElement>("#btn-cancel-modal");
  const modalNewRun = $<HTMLElement>("#modal-new-run");
  const modalOnboard = $<HTMLElement>("#modal-project-onboarding");

  if (btnOpenNewRun) btnOpenNewRun.addEventListener("click", openNewRunModal);
  if (btnHistoryNewRun)
    btnHistoryNewRun.addEventListener("click", openNewRunModal);
  if (btnQueueManual) btnQueueManual.addEventListener("click", openNewRunModal);
  if (btnRunsStart) btnRunsStart.addEventListener("click", openNewRunModal);
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeNewRunModal);
  if (btnCancelModal)
    btnCancelModal.addEventListener("click", closeNewRunModal);

  if (modalNewRun) {
    modalNewRun.addEventListener("click", (e) => {
      if (e.target === modalNewRun) closeNewRunModal();
    });
  }

  if (modalOnboard) {
    modalOnboard.addEventListener("click", (e) => {
      if (e.target === modalOnboard) modalOnboard.hidden = true;
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modalNewRun && !modalNewRun.hidden) {
        closeNewRunModal();
      }
      const modalOnboard = $<HTMLElement>("#modal-project-onboarding");
      if (modalOnboard && !modalOnboard.hidden) {
        modalOnboard.hidden = true;
      }
    }
  });
}
