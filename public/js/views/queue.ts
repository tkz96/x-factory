// public/js/views/queue.ts — Work Queue area static template.

import { createViewFromTemplate } from "./template-helper.js";

const QUEUE_TEMPLATE = `
<section id="area-queue" class="area-view active">
  <div class="queue-toolbar">
    <div class="search-box">
      <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-search"></use></svg>
      <input type="text" id="queue-search" placeholder="Filter tickets (label: agentic-workflow)…">
    </div>
    <div class="filter-pill">
      <span class="pill-dot"></span>
      <span>agentic-workflow</span>
    </div>
    <button id="btn-queue-refresh" class="btn-secondary btn-sm" title="Refresh work queue" aria-label="Refresh work queue">
      <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-refresh-cw"></use></svg>
      <span>Refresh</span>
    </button>
  </div>

  <div id="queue-tickets-list" class="tickets-grid">
    <!-- Empty state until tracker phase -->
    <div class="empty-state card">
      <div class="empty-icon">
        <svg class="icon icon-xl" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-calendar"></use></svg>
      </div>
      <h3>No Issue Tracker Connected</h3>
      <p>Configure GitHub, Jira, or Azure DevOps in Settings to pull tickets with the <code>agentic-workflow</code> label automatically.</p>
      <button id="btn-queue-manual" class="btn-secondary btn-sm" style="margin-top: 1rem;">Start Manual Run</button>
    </div>
  </div>
</section>
`;

export function createQueueView(): HTMLElement {
  return createViewFromTemplate(QUEUE_TEMPLATE);
}
