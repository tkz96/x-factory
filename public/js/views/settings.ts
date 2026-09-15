// public/js/views/settings.ts — Settings area static template.

import { createViewFromTemplate } from "./template-helper.js";

const SETTINGS_TEMPLATE = `
<section id="area-settings" class="area-view">
  <div class="settings-layout card">
    <div class="settings-sidebar">
      <button class="settings-tab-btn active" data-tab="general">General</button>
      <button class="settings-tab-btn" data-tab="trackers">Issue Trackers</button>
      <button class="settings-tab-btn" data-tab="models">Pi & Models</button>
      <button class="settings-tab-btn" data-tab="git">Git & Worktrees</button>
    </div>
    <div class="settings-content">
      <div id="tab-general" class="settings-pane active">
        <h3>General Settings</h3>
        <p class="text-muted">Workbench behavior and system defaults.</p>
        <div class="setting-item">
          <label>Data Directory</label>
          <input type="text" value="~/.x-factory" readonly class="code-input">
        </div>
      </div>
      <div id="tab-trackers" class="settings-pane">
        <h3>Issue Tracker Integration</h3>
        <p class="text-muted">Connect your issue tracker to pull <code>agentic-workflow</code> tickets.</p>
        <div class="setting-item">
          <label for="setting-tracker-provider">Default Provider</label>
          <select id="setting-tracker-provider" class="form-select">
            <option value="github">GitHub Issues</option>
            <option value="jira">Jira Software</option>
            <option value="azure">Azure DevOps</option>
          </select>
        </div>
        <div class="setting-item">
          <label>Required Workflow Label</label>
          <input type="text" value="agentic-workflow" readonly class="code-input">
        </div>

        <!-- GitHub Form Group -->
        <div id="tracker-group-github" class="tracker-form-group">
          <div class="setting-item">
            <label for="setting-github-token">GitHub Token (Optional for public/CLI repos)</label>
            <input type="password" id="setting-github-token" placeholder="ghp_••••••••" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-github-repo">Default Repository (e.g. owner/repo)</label>
            <input type="text" id="setting-github-repo" placeholder="owner/repo (auto-detected from git if blank)" class="form-input">
          </div>
        </div>

        <!-- Jira Form Group -->
        <div id="tracker-group-jira" class="tracker-form-group" hidden>
          <div class="setting-item">
            <label for="setting-jira-host">Jira Host URL</label>
            <input type="text" id="setting-jira-host" placeholder="yourcompany.atlassian.net" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-jira-email">Jira Email</label>
            <input type="email" id="setting-jira-email" placeholder="dev@company.com" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-jira-token">Jira API Token</label>
            <input type="password" id="setting-jira-token" placeholder="API Token" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-jira-project">Jira Project Key (Optional)</label>
            <input type="text" id="setting-jira-project" placeholder="e.g. PROJ" class="form-input">
          </div>
        </div>

        <!-- Azure DevOps Form Group -->
        <div id="tracker-group-azure" class="tracker-form-group" hidden>
          <div class="setting-item">
            <label for="setting-azure-org">Azure Organization URL</label>
            <input type="text" id="setting-azure-org" placeholder="https://dev.azure.com/your-org" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-azure-project">Azure Project Name</label>
            <input type="text" id="setting-azure-project" placeholder="ProjectName" class="form-input">
          </div>
          <div class="setting-item">
            <label for="setting-azure-pat">Personal Access Token (PAT)</label>
            <input type="password" id="setting-azure-pat" placeholder="PAT" class="form-input">
          </div>
        </div>
      </div>
      <div id="tab-models" class="settings-pane">
        <h3>Pi & Models</h3>
        <p class="text-muted">Configure LLM providers and models for Pi Agent sessions.</p>
        <div class="setting-item">
          <label for="setting-model-a-provider">Implementation Provider (Session A)</label>
          <input type="text" id="setting-model-a-provider" placeholder="e.g. anthropic, ollama, openai" class="form-input">
        </div>
        <div class="setting-item">
          <label for="setting-model-a-model">Implementation Model (Session A)</label>
          <input type="text" id="setting-model-a-model" placeholder="e.g. claude-3-7-sonnet or qwen2.5-coder:32b" class="form-input">
        </div>
        <div class="setting-item">
          <label for="setting-model-b-provider">Review Provider (Session B)</label>
          <input type="text" id="setting-model-b-provider" placeholder="e.g. anthropic" class="form-input">
        </div>
        <div class="setting-item">
          <label for="setting-model-b-model">Review Model (Session B)</label>
          <input type="text" id="setting-model-b-model" placeholder="e.g. claude-3-7-sonnet" class="form-input">
        </div>
      </div>
      <div id="tab-git" class="settings-pane">
        <h3>Git & Worktree Isolation</h3>
        <p class="text-muted">Worktree storage and baseline pollution rules.</p>
        <div class="setting-item">
          <label>Worktree Path</label>
          <input type="text" value="~/.x-factory/projects/:id/worktrees/:runId" readonly class="code-input">
        </div>
      </div>

      <!-- Save Actions -->
      <div class="settings-actions" style="margin-top: 1.5rem; display: flex; align-items: center; gap: 1rem;">
        <button id="btn-save-settings" class="btn-primary">Save Settings</button>
        <span id="settings-status" class="text-muted" style="font-size: 0.85rem;"></span>
      </div>
    </div>
  </div>
</section>
`;

export function createSettingsView(): HTMLElement {
  return createViewFromTemplate(SETTINGS_TEMPLATE);
}
