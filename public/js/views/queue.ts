// public/js/views/queue.ts — Work Queue area static template.

import { createViewFromTemplate } from "./template-helper.js";

const QUEUE_TEMPLATE = `
<section id="area-queue" class="area-view active">
  <div class="queue-toolbar">
    <div class="search-box">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" id="queue-search" placeholder="Filter tickets (label: agentic-workflow)…">
    </div>
    <div class="filter-pill">
      <span class="pill-dot"></span>
      <span>agentic-workflow</span>
    </div>
    <button id="btn-queue-refresh" class="btn-secondary btn-sm" title="Refresh work queue" aria-label="Refresh work queue">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
      <span>Refresh</span>
    </button>
  </div>

  <div id="queue-tickets-list" class="tickets-grid">
    <!-- Empty state until tracker phase -->
    <div class="empty-state card">
      <div class="empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
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
