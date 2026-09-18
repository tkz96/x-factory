// public/js/views/modals.ts — Modal dialog templates for New Run and Onboarding Wizard.

import { createViewFromTemplate } from "./template-helper.js";

const NEW_RUN_MODAL_TEMPLATE = `
<div id="modal-new-run" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-new-run-title" hidden>
  <div class="modal-dialog">
    <div class="modal-header">
      <h2 id="modal-new-run-title">New Factory Run</h2>
      <button id="btn-close-modal" class="btn-close" aria-label="Close dialog">
        <svg class="icon icon-xs" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-x"></use></svg>
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
<div id="modal-project-onboarding" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-onboard-title" hidden>
  <div class="modal-dialog modal-dialog-lg">
    <div class="modal-header">
      <div>
        <h2 id="modal-onboard-title">Onboard Software Project</h2>
        <span class="toolbar-subtitle">Connect a multi-repository workspace to X-Factory</span>
      </div>
      <button id="btn-close-onboard-modal" class="btn-close" aria-label="Close dialog">
        <svg class="icon icon-xs" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-x"></use></svg>
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
            <option value="azure">Azure DevOps Boards (dev.azure.com)</option>
            <option value="github">GitHub Issues</option>
            <option value="jira">Jira Software</option>
          </select>
        </div>

        <div class="form-group">
          <div class="label-with-tooltip">
            <label for="onboard-git-host">Git Hosting Provider</label>
            <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Git Hosting Provider">?
              <span class="tooltip-popover">
                <strong>Git Repository Host</strong>
                Select where your source repositories are hosted (e.g. GitHub, Azure Repos, GitLab, Bitbucket). This controls commit checks, status badges, and pull request delivery.<br>
                <a href="/docs#git-hosts" target="_blank" class="docs-link" style="color: var(--accent-primary); text-decoration: underline; margin-top: 4px; display: inline-block;">Learn more about Git hosts ↗</a>
              </span>
            </span>
          </div>
          <select id="onboard-git-host" class="form-select">
            <option value="azure">Azure Repos (dev.azure.com)</option>
            <option value="github">GitHub (github.com)</option>
            <option value="gitlab">GitLab (gitlab.com / self-hosted)</option>
            <option value="bitbucket">Bitbucket</option>
            <option value="local">Local Only / Other Git Server</option>
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
          <span id="onboard-tracker-project-hint" class="text-secondary text-xs" style="display:block; margin-top: 0.35rem; color: var(--text-dim);"></span>
        </div>

        <!-- Azure Specific Tracker Settings -->
        <div id="onboard-tracker-azure-fields-step2" class="tracker-fields-group">
          <div id="azure-tracker-fields">
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

            <div id="onboard-azure-pat-group" class="form-group" style="margin-bottom: 0.75rem;">
              <div class="label-with-tooltip">
                <label for="onboard-azure-pat-step2">Personal Access Token (PAT) — Required for Automated Scopes</label>
                <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Azure PAT Scopes">?
                  <span class="tooltip-popover">
                    <strong>Minimum Required Scopes (Least Privilege)</strong><br>
                    For security, create a custom PAT scoped strictly to:<br>
                    • <code>Work Items: Read</code> — query backlog & tickets<br>
                    • <code>Code: Read</code> — clone and discover repositories<br>
                    • <code>Code: Status</code> — publish verification badges & checks<br><br>
                    ⚠️ <em>Never grant Write, Manage, or Full Access!</em><br>
                    <a href="/docs#azure-pat" target="_blank" class="docs-link" style="color: var(--accent-primary); text-decoration: underline; margin-top: 4px; display: inline-block;">Open Full PAT Setup Guide ↗</a>
                  </span>
                </span>
              </div>
              <input id="onboard-azure-pat-step2" type="password" placeholder="Paste your Azure DevOps PAT token" class="form-input code-input">
            </div>

            <div id="azure-cli-detected-banner" class="info-banner" style="margin-bottom: 0.8rem;">
              <svg class="icon icon-sm" aria-hidden="true" style="flex-shrink:0; margin-top:2px;"><use href="/assets/icons/sprite.svg#icon-info"></use></svg>
              <div>
                <strong>Azure DevOps Authentication</strong><br>
                Auto-authenticates via your active <code>az</code> CLI session (<code>talha.zuberi@xynotech.com</code>) or Personal Access Token.
              </div>
            </div>
          </div>
        </div>

        <!-- GitHub Specific Tracker Settings -->
        <div id="onboard-github-token-group" class="tracker-fields-group" hidden>
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-github-token">GitHub Personal Access Token (Optional for public/CLI repos)</label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: GitHub Token">?
                <span class="tooltip-popover">
                  <strong>GitHub Token</strong>
                  A personal access token with <code>repo</code> scope to access private repositories or raise rate limits.
                </span>
              </span>
            </div>
            <input id="onboard-github-token" type="password" placeholder="ghp_••••••••" class="form-input code-input">
          </div>
        </div>

        <!-- Jira Specific Tracker Settings -->
        <div id="onboard-jira-fields" class="tracker-fields-group" hidden>
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-jira-host">Jira Host URL <span class="required">*</span></label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Jira Host">?
                <span class="tooltip-popover">
                  <strong>Jira Host</strong>
                  Host domain (e.g. <code>yourcompany.atlassian.net</code>).
                </span>
              </span>
            </div>
            <input id="onboard-jira-host" type="text" placeholder="yourcompany.atlassian.net" class="form-input code-input">
          </div>
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-jira-email">Jira Email <span class="required">*</span></label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Jira Email">?
                <span class="tooltip-popover">
                  <strong>Jira User Email</strong>
                  Email associated with your Atlassian account.
                </span>
              </span>
            </div>
            <input id="onboard-jira-email" type="email" placeholder="dev@company.com" class="form-input">
          </div>
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <div class="label-with-tooltip">
              <label for="onboard-jira-token">Jira API Token <span class="required">*</span></label>
              <span class="tooltip-badge" tabindex="0" role="tooltip" aria-label="Help: Jira Token">?
                <span class="tooltip-popover">
                  <strong>API Token</strong>
                  Atlassian API token created at id.atlassian.com.
                </span>
              </span>
            </div>
            <input id="onboard-jira-token" type="password" placeholder="API Token" class="form-input code-input">
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.8rem; margin-top: 1rem;">
          <button id="btn-test-tracker-connection" class="btn-secondary btn-sm" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-check"></use></svg>
            <span>Test Connection</span>
          </button>
          <span id="tracker-test-status" class="tracker-test-status"><span id="tracker-test-result"></span></span>
        </div>

        <div id="azure-scope-diagnostic-card" class="scope-diagnostic-box" hidden>
          <div class="scope-box-header">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="scope-box-title" style="font-weight:600; font-size:0.88rem;">PAT Verification & Privileges</span>
              <span id="scope-status-pill" class="badge" style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px;">Pending</span>
            </div>
            <a href="/docs#azure-pat" target="_blank" style="font-size:0.78rem; color:var(--accent); text-decoration:none;">Scopes Docs ↗</a>
          </div>
          <div class="scope-items-grid" style="display:grid; grid-template-columns: 1fr; gap: 0.4rem; margin-top: 0.6rem;">
            <div class="scope-item-row" id="scope-row-wit-read">
              <span class="scope-icon"><svg class="icon icon-sm icon-status-pending" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-clock"></use></svg></span>
              <span class="scope-label" style="font-weight:500;">Work Items: Read</span>
              <span class="scope-desc text-muted" style="font-size:0.78rem; margin-left:auto;">Query backlog work items</span>
            </div>
            <div class="scope-item-row" id="scope-row-code-read">
              <span class="scope-icon"><svg class="icon icon-sm icon-status-pending" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-clock"></use></svg></span>
              <span class="scope-label" style="font-weight:500;">Code: Read</span>
              <span class="scope-desc text-muted" style="font-size:0.78rem; margin-left:auto;">List and clone repositories</span>
            </div>
            <div class="scope-item-row" id="scope-row-code-status">
              <span class="scope-icon"><svg class="icon icon-sm icon-status-pending" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-clock"></use></svg></span>
              <span class="scope-label" style="font-weight:500;">Code: Status</span>
              <span class="scope-desc text-muted" style="font-size:0.78rem; margin-left:auto;">Commit status badges</span>
            </div>
            <div class="scope-item-row" id="scope-row-wit-write">
              <span class="scope-icon"><svg class="icon icon-sm icon-status-pending" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-clock"></use></svg></span>
              <span class="scope-label" style="font-weight:500;">Work Items: Write (Prohibited)</span>
              <span class="scope-desc text-muted" style="font-size:0.78rem; margin-left:auto;">Must NOT be granted</span>
            </div>
            <div class="scope-item-row" id="scope-row-code-full">
              <span class="scope-icon"><svg class="icon icon-sm icon-status-pending" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-clock"></use></svg></span>
              <span class="scope-label" style="font-weight:500;">Code: Full (Prohibited)</span>
              <span class="scope-desc text-muted" style="font-size:0.78rem; margin-left:auto;">Must NOT be granted</span>
            </div>
          </div>
          <div id="scope-diagnostic-alerts" style="margin-top:0.6rem; font-size:0.8rem; color:var(--red);" hidden></div>
        </div>

        <div id="scope-responsibility-notice" class="info-banner" style="margin-top: 0.8rem; font-size: 0.82rem; line-height: 1.5;">
          <svg class="icon icon-sm" aria-hidden="true" style="flex-shrink:0; margin-top:2px;"><use href="/assets/icons/sprite.svg#icon-info"></use></svg>
          <div>
            <strong>Scope Responsibility Notice:</strong> X-Factory only needs <code>Work Items: Read</code>, <code>Code: Read & write</code>, and <code>Code: Status</code>. It is your responsibility to ensure no additional scopes (such as Full, Build, Release, or Security) are granted to this token.
          </div>
        </div>

        <div id="scope-overprivileged-warning" class="warning-box" style="margin-top: 0.6rem; padding: 0.75rem; background: var(--bg-card); border-left: 3px solid var(--orange); border-radius: 4px;" hidden>
          <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
            <svg class="icon icon-sm" aria-hidden="true" style="color: var(--orange); flex-shrink:0; margin-top:2px;"><use href="/assets/icons/sprite.svg#icon-alert-triangle"></use></svg>
            <div>
              <strong style="color: var(--orange); font-size: 0.88rem;">Token Scope Notice</strong>
              <p id="scope-overprivileged-text" style="margin: 0.25rem 0 0.5rem 0; font-size: 0.8rem; color: var(--text-muted);"></p>
              <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; cursor: pointer; color: var(--text);">
                <input type="checkbox" id="chk-pat-least-privilege-ack">
                <span>I understand that X-Factory only needs minimal permissions and accept responsibility for this token's scopes.</span>
              </label>
            </div>
          </div>
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
        <div id="discovery-azure-group" style="display: none;">
          <div id="azure-discovery-fields" style="padding: 0.9rem; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; margin-bottom: 1rem;">
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
                    Azure DevOps PAT with <code>Code (Read)</code> and <code>Code (Status)</code> scopes required to list project repositories and publish check statuses online.<br>
                    <a href="/docs#azure-code" target="_blank" class="docs-link" style="color: var(--accent); text-decoration: underline; margin-top: 4px; display: inline-block;">Open Repository Scopes Guide ↗</a>
                  </span>
                </span>
              </div>
              <input id="onboard-azure-pat" type="password" placeholder="Leave blank if configured in Factory Settings" class="form-input code-input">
            </div>
          </div>
        </div>

        <div id="discovery-github-group" style="display: none; padding: 0.9rem; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; margin-bottom: 1rem;">
          <p class="text-muted" style="margin: 0; font-size: 0.88rem;">Queries GitHub repository list for the specified organization or user account.</p>
        </div>

        <div id="discovery-local-hint" style="margin-bottom: 1rem;">
          <p class="text-muted" style="margin: 0; font-size: 0.88rem;">Scans subdirectories of your local workspace path for existing Git repositories.</p>
        </div>

        <div class="discovery-trigger-box">
          <p class="text-muted" style="margin-bottom: 0.8rem;">Click Discover Repositories to query your provider (or scan local workspace folder).</p>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <button id="btn-run-discovery" class="btn-primary" type="button">
              <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-search"></use></svg>
              <span>Discover Repositories</span>
            </button>
            <span id="discovery-status-text" class="text-muted" style="font-size: 0.88rem;"><span id="discovery-status"></span></span>
          </div>
        </div>
      </div>

      <!-- Step 4: Repository Selection & Roles -->
      <div id="onboard-step-4" class="wizard-pane" hidden>
        <div class="selection-toolbar">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span id="discovered-count-label" class="bold-text"><span id="onboard-discovered-count">0</span> repositories found</span>
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
