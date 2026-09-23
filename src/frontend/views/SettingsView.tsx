// src/frontend/views/SettingsView.tsx — Workbench Settings view (XFM-38, XFM-40, XFM-51).

import "./SettingsView.css";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Project } from "../../shared/types.js";
import { useModal } from "../context/ModalContext.js";
import {
  useDiagnostics,
  useProjects,
  useSaveSettings,
  useSettings,
} from "../hooks/useQueries.js";
import { useTheme } from "../hooks/useTheme.js";

type SettingsTab = "general" | "trackers" | "models" | "git" | "diagnostics";

interface DiagnosticMetricCardProps {
  title: string;
  isOnline: boolean;
  value: string;
  detail: string;
}

function DiagnosticMetricCard({
  title,
  isOnline,
  value,
  detail,
}: DiagnosticMetricCardProps) {
  return (
    <div className="card p-4">
      <div className="flex-between">
        <span className="text-muted">{title}</span>
        <span
          className={`status-dot status-dot-sm ${isOnline ? "online" : "offline"}`}
        />
      </div>
      <strong className="metric-value-lg">{value}</strong>
      <span className="text-muted text-footnote">{detail}</span>
    </div>
  );
}

interface DiagnosticsTabContentProps {
  isLoading: boolean;
  diagnostics: ReturnType<typeof useDiagnostics>["data"];
}

function DiagnosticsTabContent({
  isLoading,
  diagnostics,
}: DiagnosticsTabContentProps) {
  if (isLoading) {
    return (
      <div className="card p-4">
        <span className="text-muted">Loading diagnostics…</span>
      </div>
    );
  }

  return (
    <div className="stack mt-4">
      <div className="diagnostics-grid">
        <DiagnosticMetricCard
          title="API Status"
          isOnline={true}
          value="Healthy"
          detail={`Uptime: ${diagnostics?.system.uptime ?? 0}s`}
        />
        <DiagnosticMetricCard
          title="Database"
          isOnline={true}
          value={`Healthy (v${diagnostics?.database.version ?? 6})`}
          detail={`WAL Mode • ${diagnostics?.database.runs.total ?? 0} Runs`}
        />
        <DiagnosticMetricCard
          title="Worker Fleet"
          isOnline={diagnostics?.worker.status === "healthy"}
          value={
            diagnostics?.worker.status === "healthy" ? "Healthy" : "Unavailable"
          }
          detail={`${diagnostics?.worker.activeCount ?? 0} Active Worker(s)`}
        />
      </div>

      <div className="card p-5">
        <h4 className="mb-4">Job Queue Telemetry</h4>
        <div className="telemetry-grid">
          <div>
            <span className="text-muted text-footnote">Active Jobs</span>
            <strong className="telemetry-num">
              {diagnostics?.database.jobs.claimed ?? 0}
            </strong>
          </div>
          <div>
            <span className="text-muted text-footnote">Pending Jobs</span>
            <strong className="telemetry-num">
              {diagnostics?.database.jobs.pending ?? 0}
            </strong>
          </div>
          <div>
            <span className="text-muted text-footnote">Stale Jobs</span>
            <strong
              className={`telemetry-num ${(diagnostics?.database.jobs.stale ?? 0) > 0 ? "text-warning" : ""}`}
            >
              {diagnostics?.database.jobs.stale ?? 0}
            </strong>
          </div>
          <div>
            <span className="text-muted text-footnote">Completed Jobs</span>
            <strong className="telemetry-num">
              {diagnostics?.database.jobs.completed ?? 0}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GeneralTabContentProps {
  currentTheme: "light" | "dark";
  onApplyTheme: (theme: "light" | "dark") => void;
}

function GeneralTabContent({
  currentTheme,
  onApplyTheme,
}: GeneralTabContentProps) {
  return (
    <div id="tab-general" className="settings-pane active">
      <h3>General Settings</h3>
      <p className="text-muted">Workbench behavior and system defaults.</p>

      <div className="setting-item mt-4">
        <span className="setting-label">Appearance</span>
        <div
          className="theme-segmented-control"
          role="radiogroup"
          aria-label="Appearance Theme"
        >
          <button
            type="button"
            className={`theme-segment-btn ${currentTheme === "light" ? "active" : ""}`}
            id="btn-theme-light"
            data-theme-val="light"
            aria-label="Light Theme"
            onClick={() => onApplyTheme("light")}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-sun" />
            </svg>
            <span>Light</span>
          </button>
          <button
            type="button"
            className={`theme-segment-btn ${currentTheme === "dark" ? "active" : ""}`}
            id="btn-theme-dark"
            data-theme-val="dark"
            aria-label="Dark Theme"
            onClick={() => onApplyTheme("dark")}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-moon" />
            </svg>
            <span>Dark</span>
          </button>
        </div>
      </div>

      <div className="setting-item mt-4">
        <label htmlFor="setting-data-dir">Data Directory</label>
        <input
          id="setting-data-dir"
          type="text"
          value="~/.x-factory"
          readOnly
          className="code-input"
        />
      </div>
    </div>
  );
}

interface ConnectionsTabContentProps {
  projects: Project[];
  isLoading: boolean;
  onOnboardProject: () => void;
}

function ConnectionsTabContent({
  projects,
  isLoading,
  onOnboardProject,
}: ConnectionsTabContentProps) {
  return (
    <div id="tab-trackers" className="settings-pane active">
      <div className="connections-header">
        <div>
          <h3>Tracker Connections</h3>
          <p className="text-muted">
            Read-only registry of projects and their configured issue tracker
            connections.
          </p>
        </div>
        <button
          type="button"
          id="btn-settings-onboard-project"
          className="btn-primary btn-sm"
          onClick={onOnboardProject}
        >
          <svg className="icon icon-sm" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-plus" />
          </svg>
          <span>Onboard Project</span>
        </button>
      </div>

      <div className="connections-registry-container">
        <table className="connections-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Tracker Provider</th>
              <th>Target</th>
              <th>Status</th>
              <th className="align-right">Action</th>
            </tr>
          </thead>
          <tbody id="connections-registry-tbody">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="text-muted text-center p-4">
                  Loading connections…
                </td>
              </tr>
            ) : projects.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted text-center p-4">
                  No projects configured.
                </td>
              </tr>
            ) : (
              projects.map((p) => {
                const provider =
                  p.issueTracker?.provider ||
                  p.issueTracker?.connectionId ||
                  "None";
                let target = "";
                if (provider === "azure") {
                  target = `${p.issueTracker?.azure?.orgUrl || ""} / ${p.issueTracker?.azure?.project || ""}`;
                } else if (provider === "jira") {
                  target = `${p.issueTracker?.jira?.host || ""} (${p.issueTracker?.jira?.project || ""})`;
                } else if (provider === "github") {
                  target = p.issueTracker?.github?.repo || "";
                }

                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>
                      <span className="badge badge-provider">{provider}</span>
                    </td>
                    <td className="text-muted connections-target">
                      {target || "—"}
                    </td>
                    <td>
                      <span
                        className={`badge ${p.archived ? "badge-status-archived" : "badge-status-active"}`}
                      >
                        {p.archived ? "Archived" : "Active"}
                      </span>
                    </td>
                    <td className="align-right">
                      <Link
                        to={`/projects/${encodeURIComponent(p.id)}`}
                        className="project-link"
                      >
                        View Project →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ModelsTabContentProps {
  settings: ReturnType<typeof useSettings>["data"];
  saveSettingsMutation: ReturnType<typeof useSaveSettings>;
}

function ModelsTabContent({
  settings,
  saveSettingsMutation,
}: ModelsTabContentProps) {
  const [modelAProvider, setModelAProvider] = useState("");
  const [modelAModel, setModelAModel] = useState("");
  const [modelBProvider, setModelBProvider] = useState("");
  const [modelBModel, setModelBModel] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.models) {
      setModelAModel(settings.models.sessionA || "");
      setModelBModel(settings.models.sessionB || settings.models.review || "");
    }
  }, [settings]);

  const handleSaveModels = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("Saving…");
    try {
      const modelsPayload: { sessionA?: string; sessionB?: string } = {};
      const a = modelAModel.trim();
      if (a) modelsPayload.sessionA = a;
      const b = modelBModel.trim();
      if (b) modelsPayload.sessionB = b;

      await saveSettingsMutation.mutateAsync({
        models: modelsPayload,
      });
      setSaveStatus("Settings saved successfully.");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus(
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div id="tab-models" className="settings-pane active">
      <h3>Pi &amp; Models</h3>
      <p className="text-muted">
        Configure LLM providers and models for Pi Agent sessions.
      </p>

      <form onSubmit={handleSaveModels} className="mt-4">
        <div className="setting-item">
          <label htmlFor="setting-model-a-provider">
            Implementation Provider (Session A)
          </label>
          <input
            type="text"
            id="setting-model-a-provider"
            placeholder="e.g. anthropic, ollama, openai"
            className="form-input"
            value={modelAProvider}
            onChange={(e) => setModelAProvider(e.target.value)}
          />
        </div>

        <div className="setting-item mt-3">
          <label htmlFor="setting-model-a-model">
            Implementation Model (Session A)
          </label>
          <input
            type="text"
            id="setting-model-a-model"
            placeholder="e.g. claude-3-7-sonnet or qwen2.5-coder:32b"
            className="form-input"
            value={modelAModel}
            onChange={(e) => setModelAModel(e.target.value)}
          />
        </div>

        <div className="setting-item mt-3">
          <label htmlFor="setting-model-b-provider">
            Review Provider (Session B)
          </label>
          <input
            type="text"
            id="setting-model-b-provider"
            placeholder="e.g. anthropic"
            className="form-input"
            value={modelBProvider}
            onChange={(e) => setModelBProvider(e.target.value)}
          />
        </div>

        <div className="setting-item mt-3">
          <label htmlFor="setting-model-b-model">
            Review Model (Session B)
          </label>
          <input
            type="text"
            id="setting-model-b-model"
            placeholder="e.g. claude-3-7-sonnet"
            className="form-input"
            value={modelBModel}
            onChange={(e) => setModelBModel(e.target.value)}
          />
        </div>

        <div className="settings-actions-bar">
          <button
            type="submit"
            id="btn-save-settings"
            className="btn-primary"
            disabled={saveSettingsMutation.isPending}
          >
            {saveSettingsMutation.isPending ? "Saving…" : "Save Model Settings"}
          </button>
          {saveStatus && (
            <span id="settings-status" className="text-muted text-footnote">
              {saveStatus}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function GitTabContent() {
  return (
    <div id="tab-git" className="settings-pane active">
      <h3>Git &amp; Worktree Isolation</h3>
      <p className="text-muted">
        Worktree storage and baseline pollution rules.
      </p>
      <div className="setting-item mt-4">
        <label htmlFor="setting-worktree-path">Worktree Path</label>
        <input
          id="setting-worktree-path"
          type="text"
          value="~/.x-factory/projects/:id/worktrees/:runId"
          readOnly
          className="code-input"
        />
      </div>
    </div>
  );
}

export function SettingsView() {
  const { data: settings } = useSettings();
  const { data: diagnostics, isLoading: isDiagLoading } = useDiagnostics();
  const { data: projects = [], isLoading: isProjectsLoading } = useProjects();
  const { openOnboardingModal } = useModal();
  const saveSettingsMutation = useSaveSettings();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { theme: currentTheme, applyTheme: handleApplyTheme } = useTheme();

  return (
    <section id="area-settings" className="area-view active">
      <div className="settings-layout card">
        {/* Settings Navigation Sidebar */}
        <div className="settings-sidebar">
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "general" ? "active" : ""}`}
            data-tab="general"
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "trackers" ? "active" : ""}`}
            data-tab="trackers"
            onClick={() => setActiveTab("trackers")}
          >
            Connections
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "models" ? "active" : ""}`}
            data-tab="models"
            onClick={() => setActiveTab("models")}
          >
            Pi &amp; Models
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "git" ? "active" : ""}`}
            data-tab="git"
            onClick={() => setActiveTab("git")}
          >
            Git &amp; Worktrees
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === "diagnostics" ? "active" : ""}`}
            data-tab="diagnostics"
            onClick={() => setActiveTab("diagnostics")}
          >
            Diagnostics
          </button>
        </div>

        {/* Settings Content Area */}
        <div className="settings-content">
          {activeTab === "general" && (
            <GeneralTabContent
              currentTheme={currentTheme}
              onApplyTheme={handleApplyTheme}
            />
          )}

          {activeTab === "trackers" && (
            <ConnectionsTabContent
              projects={projects}
              isLoading={isProjectsLoading}
              onOnboardProject={openOnboardingModal}
            />
          )}

          {activeTab === "models" && (
            <ModelsTabContent
              settings={settings}
              saveSettingsMutation={saveSettingsMutation}
            />
          )}

          {activeTab === "git" && <GitTabContent />}

          {activeTab === "diagnostics" && (
            <div id="tab-diagnostics" className="settings-pane active">
              <h3>System &amp; Worker Diagnostics</h3>
              <p className="text-muted">
                Real-time health status, database integrity, background worker
                fleet, and job telemetry.
              </p>

              <DiagnosticsTabContent
                isLoading={isDiagLoading}
                diagnostics={diagnostics}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
