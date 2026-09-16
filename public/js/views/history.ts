// public/js/views/history.ts — Factory Run History area static template.

import { createViewFromTemplate } from "./template-helper.js";

const HISTORY_TEMPLATE = `
<section id="area-history" class="area-view">
  <div class="view-panel">
    <div class="section-header-flex">
      <div>
        <h2>Factory Run History</h2>
        <p class="text-muted">All previous, active, and completed factory runs.</p>
      </div>
      <button id="btn-history-new-run" class="btn-primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>New Run</span>
      </button>
    </div>
    <div id="history-runs-container">
      <div class="empty-state card">
        <p>Loading run history…</p>
      </div>
    </div>
  </div>
</section>
`;

export function createHistoryView(): HTMLElement {
  return createViewFromTemplate(HISTORY_TEMPLATE);
}
