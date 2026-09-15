// public/js/views/modals.ts — Modal dialog templates for New Run and Onboarding Wizard.

import { createViewFromTemplate } from "./template-helper.js";

const NEW_RUN_MODAL_TEMPLATE = `
<div id="modal-new-run" class="modal-backdrop" hidden>
  <div class="modal-dialog">
    <div class="modal-header">
      <h2>New Factory Run</h2>
      <button id="btn-close-modal" class="btn-close" aria-label="Close dialog">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="2" y1="2" x2="12" y2="12"/>
          <line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <section id="view-setup" class="view active">
        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="input-ticket-id">Ticket ID</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Ticket ID">?
              <span class="tooltip-popover">
                <strong>Ticket Identifier</strong>
                Unique identifier of the ticket in your issue tracker (e.g. <code>VEND-101</code>, <code>#42</code>, or <code>AB#1234</code>).
              </span>
            </span>
          </div>
          <input id="input-ticket-id" type="text" placeholder="e.g. PROJ-101">
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="input-ticket-title">Ticket Title</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Ticket Title">?
              <span class="tooltip-popover">
                <strong>Ticket Title</strong>
                Summary description of the task or feature to implement.
              </span>
            </span>
          </div>
          <input id="input-ticket-title" type="text" placeholder="e.g. Implement password reset rate limiting">
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="input-branch">Custom Branch (Optional — auto-generated if blank)</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Custom Branch">?
              <span class="tooltip-popover">
                <strong>Git Branch</strong>
                Branch name created across all repository worktrees. If left blank, X-Factory generates one from the ticket ID and slug.
              </span>
            </span>
          </div>
          <input id="input-branch" type="text" placeholder="factory/ticket-slug (auto-generated)">
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="input-criteria">Acceptance Criteria (one per line)</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Acceptance Criteria">?
              <span class="tooltip-popover">
                <strong>Acceptance Criteria</strong>
                List each testable condition or requirement on its own line. Pi checks these criteria during the Test & Verify stage.
              </span>
            </span>
          </div>
          <textarea id="input-criteria" rows="4" placeholder="- Return 429 after 5 failed attempts&#10;- Reset counter after 15 minutes&#10;- Add unit tests for window expiration"></textarea>
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="input-plan">Implementation Plan</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Implementation Plan">?
              <span class="tooltip-popover">
                <strong>Implementation Plan</strong>
                Step-by-step instructions or architectural guidance for the coding agent.
              </span>
            </span>
          </div>
          <textarea id="input-plan" rows="7" placeholder="Paste the step-by-step implementation plan here…"></textarea>
        </div>

        <div class="knowledge-status" id="knowledge-status"></div>

        <div class="modal-actions">
          <button id="btn-cancel-modal" class="btn-secondary">Cancel</button>
          <button id="btn-start" class="btn-primary" disabled>Start Factory Run</button>
        </div>

        <div id="setup-error" class="error-message" hidden></div>
      </section>
    </div>
  </div>
</div>
`;

const WIZARD_MODAL_TEMPLATE = `
<div id="modal-project-onboarding" class="modal-backdrop" hidden>
  <div class="modal-dialog modal-dialog-lg">
    <div class="modal-header">
      <div>
        <h2>Onboard Software Project</h2>
        <span class="toolbar-subtitle">Connect a multi-repository workspace to X-Factory</span>
      </div>
      <button id="btn-close-onboard-modal" class="btn-close" aria-label="Close dialog">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="2" y1="2" x2="12" y2="12"/>
          <line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>
    </div>

    <!-- Stepper Indicator -->
    <div class="stepper-bar">
      <div class="step-indicator active" data-step="1">
        <span class="step-num">1</span>
        <span class="step-title">Basics</span>
      </div>
      <div class="step-indicator" data-step="2">
        <span class="step-num">2</span>
        <span class="step-title">Tracker</span>
      </div>
      <div class="step-indicator" data-step="3">
        <span class="step-num">3</span>
        <span class="step-title">Discovery</span>
      </div>
      <div class="step-indicator" data-step="4">
        <span class="step-num">4</span>
        <span class="step-title">Repositories</span>
      </div>
      <div class="step-indicator" data-step="5">
        <span class="step-num">5</span>
        <span class="step-title">Inspection</span>
      </div>
      <div class="step-indicator" data-step="6">
        <span class="step-num">6</span>
        <span class="step-title">Review</span>
      </div>
    </div>

    <div class="modal-body">
      <!-- Step 1: Basics -->
      <div id="onboard-step-1" class="wizard-pane active">
        <div class="quick-url-box">
          <div class="quick-url-header">
            <span>⚡ Quick Setup from URL</span>
            <span style="font-size: 0.75rem; color: var(--text-dim); font-weight: normal;">Auto-detects provider, project & repos</span>
          </div>
          <input id="onboard-quick-url" type="text" placeholder="Paste URL (e.g. dev.azure.com/xynotech/Converso or github.com/owner/repo)" class="form-input code-input">
          <div id="quick-url-feedback" class="quick-url-feedback" hidden></div>
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-proj-name">Project Display Name <span class="required">*</span></label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Project Display Name">?
              <span class="tooltip-popover">
                <strong>Project Display Name</strong>
                The human-readable name for this software product (e.g. <code>Converso</code>, <code>VendifAI Platform</code>). Displayed on project cards, active run headers, and pull request titles.
              </span>
            </span>
          </div>
          <input id="onboard-proj-name" type="text" placeholder="e.g. Converso" class="form-input" required>
        </div>
        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-proj-id">Stable Project Identifier <span class="required">*</span></label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Stable Project Identifier">?
              <span class="tooltip-popover">
                <strong>Stable Project Identifier</strong>
                A unique, lowercase alphanumeric identifier (e.g. <code>converso</code>, <code>vendifai</code>) used across run directories, isolated worktrees, and automated branch names. Automatically generated as you type the name.
              </span>
            </span>
          </div>
          <input id="onboard-proj-id" type="text" placeholder="e.g. converso" class="form-input code-input" required>
        </div>
        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-workspace-path">Local Workspace Root Directory</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Local Workspace Root Directory">?
              <span class="tooltip-popover">
                <strong>Workspace Root Directory</strong>
                The directory path on your computer where this product's git checkouts are located (e.g. <code>/Users/name/projects</code>). X-Factory scans this folder during discovery and prepares isolated worktrees here.
              </span>
            </span>
          </div>
          <input id="onboard-workspace-path" type="text" placeholder="e.g. ~/projects or /Users/talhazuberi/projects" class="form-input code-input">
          <div id="workspace-path-feedback" class="path-feedback-box"></div>
        </div>
      </div>

      <!-- Step 2: Issue Tracker -->
      <div id="onboard-step-2" class="wizard-pane" hidden>
        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-tracker-connection">Issue Tracker Connection</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Issue Tracker Connection">?
              <span class="tooltip-popover">
                <strong>Issue Tracker Platform</strong>
                Select where your team manages backlog work items:<br>
                • <strong>Azure DevOps</strong>: Queries boards with WIQL.<br>
                • <strong>GitHub Issues</strong>: Queries repository issues via REST.<br>
                • <strong>Jira Software</strong>: Queries Jira cloud/server with JQL.<br>
                X-Factory automatically fetches tickets labeled <code>agentic-workflow</code>.
              </span>
            </span>
          </div>
          <select id="onboard-tracker-connection" class="form-select">
            <option value="azure">Azure DevOps (dev.azure.com)</option>
            <option value="github">GitHub Issues</option>
            <option value="jira">Jira Software</option>
          </select>
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-tracker-project">Tracker Project / Board Key</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Tracker Project">?
              <span class="tooltip-popover">
                <strong>Tracker Project Key</strong>
                The identifier used to query issues:<br>
                • <strong>Azure DevOps</strong>: Project name (e.g. <code>Converso</code>).<br>
                • <strong>GitHub</strong>: Repository or organization (e.g. <code>owner/repo</code> or <code>my-org</code>).<br>
                • <strong>Jira</strong>: Project key (e.g. <code>CONV</code>, from ticket keys like <code>CONV-123</code>).
              </span>
            </span>
          </div>
          <input id="onboard-tracker-project" type="text" placeholder="e.g. Converso (or owner/repo for GitHub)" class="form-input">
        </div>

        <!-- Azure Specific Tracker Settings -->
        <div id="azure-tracker-fields" class="tracker-fields-group">
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-azure-org-url-step2">Azure Organization URL</label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Azure Organization URL">?
                <span class="tooltip-popover">
                  <strong>Organization URL</strong>
                  Azure DevOps web URL (e.g. <code>https://dev.azure.com/xynotech</code>).
                </span>
              </span>
            </div>
            <input id="onboard-azure-org-url-step2" type="text" placeholder="https://dev.azure.com/xynotech" class="form-input code-input">
          </div>

          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-azure-pat-step2">Personal Access Token (PAT) — Optional with Azure CLI</label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Azure PAT">?
                <span class="tooltip-popover">
                  <strong>PAT or Azure CLI</strong>
                  If logged in via <code>az login</code>, X-Factory authenticates automatically without requiring a PAT.
                </span>
              </span>
            </div>
            <input id="onboard-azure-pat-step2" type="password" placeholder="Leave blank to use active Azure CLI session" class="form-input code-input">
          </div>

          <div id="azure-cli-detected-banner" class="info-banner" style="margin-bottom: 0.8rem;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div>
              <strong>Azure DevOps Authentication</strong><br>
              Auto-authenticates via your active <code>az</code> CLI session (<code>talha.zuberi@xynotech.com</code>) or Personal Access Token.
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.8rem; margin-top: 1rem;">
          <button id="btn-test-tracker-connection" class="btn-secondary btn-sm" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Test Connection</span>
          </button>
          <span id="tracker-test-status" class="tracker-test-status"></span>
        </div>
      </div>

      <!-- Step 3: Discovery Provider & Primary Repo Anchor -->
      <div id="onboard-step-3" class="wizard-pane" hidden>
        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-discovery-source">Repository Source Provider</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Repository Source Provider">?
              <span class="tooltip-popover">
                <strong>Discovery Provider Options</strong>
                Choose where X-Factory discovers repositories for this product:<br>
                • <strong>Local Workspace Folder</strong>: <em>(Recommended for local development)</em> Scans your local directory for Git clones. Requires zero online tokens or PATs!<br>
                • <strong>Azure DevOps</strong>: Queries Azure Repos REST API for all git repositories in your project. Requires Org URL and PAT with <code>Code (Read)</code> permission.<br>
                • <strong>GitHub</strong>: Queries GitHub REST API for org/user repositories.<br>
                • <strong>Jira</strong>: Queries Jira project components or matches local repositories.
              </span>
            </span>
          </div>
          <select id="onboard-discovery-source" class="form-select">
            <option value="local">Local Workspace Folder (Scan subdirectories)</option>
            <option value="azure">Azure DevOps Git Repositories</option>
            <option value="github">GitHub Organization / Repositories</option>
            <option value="jira">Jira Project Components</option>
          </select>
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-primary-repo">Primary Repository Anchor</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Primary Repository Anchor">?
              <span class="tooltip-popover">
                <strong>Primary Repository Anchor</strong>
                The main repository for this software product. You can enter either a repository name (e.g. <code>converso-web</code>) or a full Azure DevOps / GitHub clone URL (e.g. <code>https://dev.azure.com/xynotech/Converso/_git/converso-web</code>). X-Factory automatically parses the organization and project names from the URL.
              </span>
            </span>
          </div>
          <input id="onboard-primary-repo" type="text" placeholder="e.g. converso-web (or https://dev.azure.com/org/project)" class="form-input">
        </div>

        <!-- Optional Azure DevOps credentials fields when Azure is selected -->
        <div id="azure-discovery-fields" style="display: none; padding: 0.9rem; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; margin-bottom: 1rem;">
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-azure-org-url">Azure Organization URL</label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Azure Organization URL">?
                <span class="tooltip-popover">
                  <strong>Azure DevOps Organization URL</strong>
                  The web URL of your organization (e.g. <code>https://dev.azure.com/xynotech</code> or <code>https://xynotech.visualstudio.com</code>). Automatically extracted if you paste a full repository URL into the anchor input above.
                </span>
              </span>
            </div>
            <input id="onboard-azure-org-url" type="text" placeholder="e.g. https://dev.azure.com/xynotech" class="form-input code-input">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <div class="label-with-tooltip">
              <label for="onboard-azure-pat">Personal Access Token (PAT)</label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Azure PAT">?
                <span class="tooltip-popover">
                  <strong>Personal Access Token (PAT)</strong>
                  Azure DevOps PAT with <code>Code (Read)</code> scope required to list project repositories online. If you already configured this in Factory Settings (Settings → Trackers), leave this field blank.
                </span>
              </span>
            </div>
            <input id="onboard-azure-pat" type="password" placeholder="Leave blank if configured in Factory Settings" class="form-input code-input">
          </div>
        </div>

        <div class="discovery-trigger-box">
          <p class="text-muted" style="margin-bottom: 0.8rem;">Click Discover Repositories to query your provider (or scan local workspace folder).</p>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <button id="btn-run-discovery" class="btn-primary" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>Discover Repositories</span>
            </button>
            <span id="discovery-status-text" class="text-muted" style="font-size: 0.88rem;"></span>
          </div>
        </div>
      </div>

      <!-- Step 4: Repository Selection & Roles -->
      <div id="onboard-step-4" class="wizard-pane" hidden>
        <div class="selection-toolbar">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span id="discovered-count-label" class="bold-text">0 repositories found</span>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Repository Roles">?
              <span class="tooltip-popover">
                <strong>Assigning Repository Roles</strong>
                Assign each repository its functional role in the system: Frontend (UI/Web), Backend (APIs/Services), Worker (Queues/Background jobs), Mobile, Infrastructure, or Other.
              </span>
            </span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input id="onboard-repo-search" type="text" placeholder="Filter repositories…" class="form-input form-input-sm" style="width: 180px;">
            <button id="btn-select-all-repos" class="btn-secondary btn-sm" type="button">Select All</button>
            <button id="btn-deselect-all-repos" class="btn-secondary btn-sm" type="button">Deselect All</button>
          </div>
        </div>
        <div id="onboard-repo-checklist" class="onboard-repo-checklist">
          <!-- Checkbox items rendered here -->
        </div>
        <div class="form-group" style="margin-top: 1.2rem;">
          <div class="label-with-tooltip">
            <label for="onboard-knowledge-select">Knowledge Repository (Optional Graphify Model)</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Knowledge Repository">?
              <span class="tooltip-popover">
                <strong>Knowledge Repository</strong>
                An architectural or documentation repository (such as a Graphify knowledge graph). During the Understand stage, Pi uses this repository to synthesize cross-service contracts and conventions.
              </span>
            </span>
          </div>
          <select id="onboard-knowledge-select" class="form-select">
            <option value="">No knowledge repository</option>
          </select>
        </div>
      </div>

      <!-- Step 5: Inspection & Commands -->
      <div id="onboard-step-5" class="wizard-pane" hidden>
        <p class="text-muted" style="margin-bottom: 1rem;">
          Inspect each local repository to detect Git branch, remote, tooling, and verification commands.
        </p>
        <div id="onboard-inspection-list" class="inspection-cards-list">
          <!-- Inspection items rendered here -->
        </div>
      </div>

      <!-- Step 6: Review & Final Save -->
      <div id="onboard-step-6" class="wizard-pane" hidden>
        <div class="review-summary-box">
          <h3 id="review-summary-title">Review Project Architecture</h3>
          <p class="text-muted" style="margin-bottom: 1rem;">Verify the configuration and multi-repository workspace structure before saving.</p>

          <div id="review-architecture-card" class="review-card-grid">
            <!-- Rendered dynamically -->
          </div>

          <div class="section-header-flex" style="margin-top: 1rem; margin-bottom: 0.5rem;">
            <h4 style="margin: 0; font-size: 0.9rem;">Configured Repositories (<span id="review-repo-count">0</span>)</h4>
          </div>
          <div id="review-repos-table-container" style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem;">
            <table class="review-repos-table">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Role</th>
                  <th>Local Path</th>
                  <th>Verification</th>
                </tr>
              </thead>
              <tbody id="review-repos-tbody"></tbody>
            </table>
          </div>

          <details style="margin-top: 1rem;">
            <summary style="font-size: 0.8rem; color: var(--text-dim); cursor: pointer; user-select: none;">Raw JSON Configuration (projects.json)</summary>
            <div class="code-preview-container">
              <pre id="review-json-preview"><code>{}</code></pre>
            </div>
          </details>
        </div>
      </div>

      <div id="onboard-error-box" class="error-message" hidden></div>
    </div>

    <!-- Stepper Action Buttons -->
    <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 1.5rem; border-top: 1px solid var(--border-subtle);">
      <button id="btn-onboard-cancel" class="btn-secondary" type="button">Cancel</button>
      <div style="display: flex; gap: 0.6rem;">
        <button id="btn-onboard-prev" class="btn-secondary" type="button" disabled>Previous</button>
        <button id="btn-onboard-next" class="btn-primary" type="button">Next</button>
        <button id="btn-onboard-save" class="btn-primary" type="button" hidden>Save Project</button>
      </div>
    </div>
  </div>
</div>
`;

function createNewRunModal(): HTMLElement {
  return createViewFromTemplate(NEW_RUN_MODAL_TEMPLATE);
}

function createWizardModal(): HTMLElement {
  return createViewFromTemplate(WIZARD_MODAL_TEMPLATE);
}

export function createModals(): HTMLElement[] {
  return [createNewRunModal(), createWizardModal()];
}
