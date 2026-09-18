// public/js/views/settings.ts — Settings area static template.

import { createViewFromTemplate } from "./template-helper.js";

const SETTINGS_TEMPLATE = `
<section id="area-settings" class="area-view">
  <div class="settings-layout card">
    <div class="settings-sidebar">
      <button class="settings-tab-btn active" data-tab="general">General</button>
      <button class="settings-tab-btn" data-tab="trackers">Connections</button>
      <button class="settings-tab-btn" data-tab="models">Pi & Models</button>
      <button class="settings-tab-btn" data-tab="git">Git & Worktrees</button>
    </div>
    <div class="settings-content">
      <div id="tab-general" class="settings-pane active">
        <h3>General Settings</h3>
        <p class="text-muted">Workbench behavior and system defaults.</p>
        <div class="setting-item">
          <label>Appearance</label>
          <div class="theme-segmented-control" role="radiogroup" aria-label="Appearance Theme">
            <button type="button" class="theme-segment-btn" id="btn-theme-light" data-theme-val="light" aria-label="Light Theme">
              <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-sun"></use></svg>
              <span>Light</span>
            </button>
            <button type="button" class="theme-segment-btn" id="btn-theme-dark" data-theme-val="dark" aria-label="Dark Theme">
              <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-moon"></use></svg>
              <span>Dark</span>
            </button>
          </div>
        </div>
        <div class="setting-item">
          <label for="setting-data-dir">Data Directory</label>
          <input id="setting-data-dir" type="text" value="~/.x-factory" readonly class="code-input">
        </div>
      </div>
      <div id="tab-trackers" class="settings-pane">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
          <div>
            <h3>Tracker Connections</h3>
            <p class="text-muted">Read-only registry of projects and their configured issue tracker connections.</p>
          </div>
          <button id="btn-settings-onboard-project" class="btn-primary btn-sm">
            <svg class="icon icon-sm" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-plus"></use></svg>
            <span>Onboard Project</span>
          </button>
        </div>
        <div class="connections-registry-container" style="margin-top: 1rem; overflow-x: auto;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--border);">
                <th style="padding: 0.5rem;">Project</th>
                <th style="padding: 0.5rem;">Tracker Provider</th>
                <th style="padding: 0.5rem;">Target</th>
                <th style="padding: 0.5rem;">Status</th>
                <th style="padding: 0.5rem; text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="connections-registry-tbody">
              <tr>
                <td colspan="5" style="padding: 1rem; text-align: center;" class="text-muted">Loading connections...</td>
              </tr>
            </tbody>
          </table>
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

        <!-- Save Actions for Models -->
        <div class="settings-actions" style="margin-top: 1.5rem; display: flex; align-items: center; gap: 1rem;">
          <button id="btn-save-settings" class="btn-primary">Save Model Settings</button>
          <span id="settings-status" class="text-muted" style="font-size: 0.85rem;"></span>
        </div>
      </div>
      <div id="tab-git" class="settings-pane">
        <h3>Git & Worktree Isolation</h3>
        <p class="text-muted">Worktree storage and baseline pollution rules.</p>
        <div class="setting-item">
          <label for="setting-worktree-path">Worktree Path</label>
          <input id="setting-worktree-path" type="text" value="~/.x-factory/projects/:id/worktrees/:runId" readonly class="code-input">
        </div>
      </div>
    </div>
  </div>
</section>
`;

export function createSettingsView(): HTMLElement {
  return createViewFromTemplate(SETTINGS_TEMPLATE);
}
