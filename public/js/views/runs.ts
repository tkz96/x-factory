// public/js/views/runs.ts — Active Runs workbench area static template.

import { createViewFromTemplate } from "./template-helper.js";

const RUNS_TEMPLATE = `
<section id="area-runs" class="area-view">
  <!-- Standby state when no active run -->
  <div id="runs-standby" class="empty-state card" hidden>
    <div class="empty-icon">
      <svg class="icon icon-xl" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-play"></use></svg>
    </div>
    <h3>No Active Factory Run</h3>
    <p>Start a run from the Work Queue or click New Run to launch a task.</p>
    <button id="btn-runs-start" class="btn-primary btn-sm" style="margin-top: 1rem;">Launch New Run</button>
  </div>

  <!-- 6-Stage Workflow Stepper -->
  <div class="workflow-stepper card" id="workflow-stepper">
    <div class="stepper-track">
      <div class="step" data-stage="prepare">
        <div class="step-dot">1</div>
        <div class="step-label">Prepare</div>
        <div class="step-evidence" id="evidence-prepare">Workspace & Worktree</div>
      </div>
      <div class="step" data-stage="understand">
        <div class="step-dot">2</div>
        <div class="step-label">Understand</div>
        <div class="step-evidence" id="evidence-understand">Context Synthesis</div>
      </div>
      <div class="step" data-stage="implement">
        <div class="step-dot">3</div>
        <div class="step-label">Implement</div>
        <div class="step-evidence" id="evidence-implement">Pi Session A</div>
      </div>
      <div class="step" data-stage="verify">
        <div class="step-dot">4</div>
        <div class="step-label">Verify</div>
        <div class="step-evidence" id="evidence-verify">Deterministic Checks</div>
      </div>
      <div class="step" data-stage="review">
        <div class="step-dot">5</div>
        <div class="step-label">Review</div>
        <div class="step-evidence" id="evidence-review">Read-Only Session B</div>
      </div>
      <div class="step" data-stage="deliver">
        <div class="step-dot">6</div>
        <div class="step-label">Deliver</div>
        <div class="step-evidence" id="evidence-deliver">PR Checkpoint</div>
      </div>
    </div>
  </div>

  <!-- Run Execution View (View Run) -->
  <div id="view-run" class="view">
    <div class="card" style="margin-top: 1.2rem;">
      <div class="run-header">
        <div>
          <h2 id="run-title">Run</h2>
          <span id="run-branch" class="code-sub"></span>
        </div>
        <span id="run-status" class="badge">preparing</span>
      </div>

      <!-- Live Activity Log -->
      <h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">Live Activity</h3>
      <div id="event-log" class="event-log" aria-live="polite" role="log">
        <!-- Events appended here -->
      </div>

      <div class="steer-bar" id="steer-bar">
        <input id="input-steer" type="text" placeholder="Send steering instruction to active Pi session…">
        <button id="btn-steer" class="btn-secondary">Steer</button>
      </div>

      <div class="run-actions">
        <button id="btn-stop" class="btn-danger">Stop Run</button>
      </div>

      <div id="run-error" class="error-message" hidden></div>
    </div>

    <!-- Live Diff Preview -->
    <div class="card" id="run-diff-card" style="margin-top: 1.2rem;" hidden>
      <div class="section-header">
        <h3>Worktree Git Diff</h3>
        <span id="run-diff-files" class="badge">0 files</span>
      </div>
      <pre id="run-diff-content" class="diff-viewer"></pre>
    </div>
  </div>

  <!-- Result View (Human Checkpoint & Delivery) -->
  <div id="view-result" class="view">
    <div class="workflow-stepper card" id="result-stepper">
      <div class="stepper-track">
        <div class="step" data-stage="prepare">
          <div class="step-dot">1</div>
          <div class="step-label">Prepare</div>
          <div class="step-evidence" id="res-evidence-prepare">Complete</div>
        </div>
        <div class="step" data-stage="understand">
          <div class="step-dot">2</div>
          <div class="step-label">Understand</div>
          <div class="step-evidence" id="res-evidence-understand">Complete</div>
        </div>
        <div class="step" data-stage="implement">
          <div class="step-dot">3</div>
          <div class="step-label">Implement</div>
          <div class="step-evidence" id="res-evidence-implement">Complete</div>
        </div>
        <div class="step" data-stage="verify">
          <div class="step-dot">4</div>
          <div class="step-label">Verify</div>
          <div class="step-evidence" id="res-evidence-verify">Complete</div>
        </div>
        <div class="step" data-stage="review">
          <div class="step-dot">5</div>
          <div class="step-label">Review</div>
          <div class="step-evidence" id="res-evidence-review">Complete</div>
        </div>
        <div class="step" data-stage="deliver">
          <div class="step-dot">6</div>
          <div class="step-label">Deliver</div>
          <div class="step-evidence" id="res-evidence-deliver">Ready</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 1.2rem;">
      <div class="run-header">
        <h2 id="result-heading">Human Checkpoint & Evidence</h2>
        <span id="result-status-badge" class="badge">ready_for_pr</span>
      </div>

      <!-- Verification Evidence -->
      <div class="result-section">
        <h3>1. Deterministic Verification</h3>
        <div class="evidence-row">
          <span id="result-tests" class="badge">—</span>
          <span id="result-repair-count" class="badge badge-neutral">Attempt 1</span>
        </div>
        <pre id="result-test-output" class="test-output" hidden></pre>
      </div>

      <!-- Read-Only Review Evidence -->
      <div class="result-section" id="review-section">
        <h3>2. Independent Review (Read-Only Session B)</h3>
        <div class="evidence-row">
          <span id="result-review-badge" class="badge">—</span>
          <span id="result-review-summary" class="evidence-text"></span>
        </div>
        <div id="criteria-checklist" class="criteria-list"></div>
        <div id="findings-list" class="findings-list"></div>
      </div>

      <!-- Git Diff Evidence -->
      <div class="result-section">
        <div class="section-header">
          <h3>3. Implementation Git Diff</h3>
          <span id="result-diff-count" class="badge">0 files</span>
        </div>
        <pre id="result-diff" class="diff-viewer"></pre>
      </div>

      <!-- Human Delivery Checkpoint -->
      <div class="delivery-checkpoint" id="delivery-checkpoint">
        <h3>4. Delivery Checkpoint</h3>
        <p class="checkpoint-text">
          All automated verification tests passed and the read-only reviewer confirmed acceptance criteria.
          Confirm below to commit, push, and open the Pull Request.
        </p>
        <button id="btn-pr" class="btn-primary">Create Pull Request</button>
      </div>

      <div id="pr-steps" class="pr-steps" hidden></div>

      <div id="pr-result" class="pr-result" hidden>
        <h3>Pull Request Created</h3>
        <a id="pr-link" href="#" target="_blank" rel="noopener">Open Pull Request</a>
      </div>

      <button id="btn-new" class="btn-secondary" style="margin-top: 1.5rem">Start New Run</button>

      <div id="result-error" class="error-message" hidden></div>
    </div>
  </div>
</section>
`;

export function createRunsView(): HTMLElement {
  return createViewFromTemplate(RUNS_TEMPLATE);
}
