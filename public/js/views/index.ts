// public/js/views/index.ts — Orchestrator mounting view templates into DOM containers.

import { createHistoryView } from "./history.js";
import { createModals } from "./modals.js";
import { createProjectsView } from "./projects.js";
import { createQueueView } from "./queue.js";
import { createRunsView } from "./runs.js";
import { createSettingsView } from "./settings.js";

export function mountViews(): void {
  const viewport = document.querySelector<HTMLElement>("#viewport-container");
  const modalContainer =
    document.querySelector<HTMLElement>("#modal-container");
  if (!viewport || !modalContainer) {
    throw new Error(
      "Missing #viewport-container or #modal-container in document shell",
    );
  }

  viewport.appendChild(createQueueView());
  viewport.appendChild(createRunsView());
  viewport.appendChild(createHistoryView());
  viewport.appendChild(createProjectsView());
  viewport.appendChild(createSettingsView());

  for (const modal of createModals()) {
    modalContainer.appendChild(modal);
  }
}
