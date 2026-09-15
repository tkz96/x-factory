// public/js/views/history.ts — Factory Run History area static template.

import { createViewFromTemplate } from "./template-helper.js";

const HISTORY_TEMPLATE = `
<section id="area-history" class="area-view">
  <div class="card">
    <h2>Factory Run History</h2>
    <p class="text-muted" style="margin-bottom: 1.2rem;">All previous, active, and completed factory runs.</p>
    <div id="history-runs-container">
      <div class="empty-state">
        <p>Loading run history…</p>
      </div>
    </div>
  </div>
</section>
`;

export function createHistoryView(): HTMLElement {
  return createViewFromTemplate(HISTORY_TEMPLATE);
}
