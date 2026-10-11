// src/frontend/views/SettingsView.tsx — Workbench Settings view (XFM-38, XFM-40, XFM-51).

import "./SettingsView.css";

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Project } from "../../shared/types.js";
import { ConnectionComboLine } from "../components/connections/ConnectionComboLine.js";
import { comboTone } from "../components/connections/connection-state.js";
import { CONNECTIONS_COPY } from "../components/feedback/copy-map.js";
import { RetryAction } from "../components/feedback/RetryAction.js";
import { Modal, ModalFooter } from "../components/Modal.js";
import {
  comboSlots,
  deriveConnectionIntegrity,
  REQUIRED_POST_CREATION_ROLES,
  recordedConnectionIdentityTargets,
} from "../components/projects/connection-integrity.js";
import { DesktopNotificationsSetting } from "../components/settings/DesktopNotificationsSetting.js";
import { ModelConnectionsPanel } from "../components/settings/ModelConnectionsPanel.js";
import { RolesPanel } from "../components/settings/RolesPanel.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { useModal } from "../context/ModalContext.js";
import { useConnectionLines } from "../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import {
  useDiagnostics,
  useProjects,
  useSaveSettings,
  useSettings,
} from "../hooks/useQueries.js";
import {
  type AppearanceSetting,
  resolveInitialTheme,
  setTheme,
  type ThemeName,
  useTheme,
} from "../hooks/useTheme.js";

type SettingsTab = "general" | "trackers" | "models" | "git" | "diagnostics";

/** The panes the `?tab=` query string may open (#278 links straight to Models). */
const SETTINGS_TABS: readonly SettingsTab[] = [
  "general",
  "trackers",
  "models",
  "git",
  "diagnostics",
];

function settingsTabFromParam(value: string | null): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? "general";
}

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
  currentTheme?: ThemeName | undefined;
  onApplyTheme: (theme: ThemeName) => void;
  currentAppearance?: AppearanceSetting | undefined;
  onApplyAppearance: (appearance: AppearanceSetting) => void;
  allowUnsandboxed: boolean;
  onUpdateUnsandboxed: (enabled: boolean) => Promise<void>;
  isSavingUnsandboxed?: boolean;
}

const THEME_CHOICES: { id: ThemeName; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "graphite", label: "Graphite" },
  { id: "sandstone", label: "Sandstone" },
];

/** The Appearance choices, in the order the segmented control shows them. */
const APPEARANCE_CHOICES: {
  id: AppearanceSetting;
  label: string;
  icon: string;
}[] = [
  { id: "automatic", label: "Automatic", icon: "icon-refresh-cw" },
  { id: "light", label: "Light", icon: "icon-sun" },
  { id: "dark", label: "Dark", icon: "icon-moon" },
];

function GeneralTabContent({
  currentTheme = "default",
  onApplyTheme,
  currentAppearance = "automatic",
  onApplyAppearance,
  allowUnsandboxed,
  onUpdateUnsandboxed,
  isSavingUnsandboxed,
}: GeneralTabContentProps) {
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setShowConfirmModal(true);
    } else {
      void onUpdateUnsandboxed(false);
    }
  };

  const handleConfirm = async () => {
    await onUpdateUnsandboxed(true);
    setShowConfirmModal(false);
  };

  const handleCancel = () => {
    setShowConfirmModal(false);
  };

  return (
    <div id="tab-general" className="settings-pane active">
      <h3>General Settings</h3>
      <p className="text-muted">Workbench behavior and system defaults.</p>

      <div className="setting-item mt-4">
        <span className="setting-label">Theme</span>
        <div className="theme-segmented-control">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={currentTheme === choice.id}
              className={`theme-segment-btn ${currentTheme === choice.id ? "active" : ""}`}
              id={`btn-theme-${choice.id}`}
              data-theme-val={choice.id}
              aria-label={`${choice.label} Theme`}
              onClick={() => onApplyTheme(choice.id)}
            >
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setting-item mt-4">
        <span className="setting-label">Appearance</span>
        {/* The appearance choice is the segmented control block (#251): one
            control, arrow keys between options, the choice announced as
            checked. The Theme control above stays hand-rolled until its own
            ticket moves it. */}
        <SegmentedControl
          label="Appearance"
          value={currentAppearance}
          onChange={(id) => {
            const choice = APPEARANCE_CHOICES.find((item) => item.id === id);
            if (choice !== undefined) onApplyAppearance(choice.id);
          }}
          options={APPEARANCE_CHOICES.map((choice) => ({
            id: choice.id,
            label: choice.label,
            icon: choice.icon,
            accessibleLabel: `${choice.label} Appearance`,
          }))}
        />
      </div>

      <div className="setting-item mt-4">
        <DesktopNotificationsSetting />
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

      <div className="setting-item mt-4">
        <span className="setting-label">Security &amp; Sandboxing</span>
        <div className="setting-checkbox-row">
          <input
            id="setting-allow-unsandboxed"
            type="checkbox"
            className="setting-checkbox"
            checked={allowUnsandboxed}
            disabled={isSavingUnsandboxed}
            onChange={handleCheckboxChange}
          />
          <div className="setting-checkbox-text">
            <label
              htmlFor="setting-allow-unsandboxed"
              className="setting-checkbox-title"
            >
              Run agents without a sandbox
            </label>
            <p className="text-muted text-footnote m-0">
              Allows the coding loop to run directly on the host machine when{" "}
              <code>sbx</code> is unavailable.
            </p>
          </div>
        </div>
      </div>

      {/* Help lives here and in the command palette, at every width (#258). */}
      <div className="setting-item mt-4">
        <span className="setting-label">Help</span>
        <ul className="settings-help-links">
          <li>
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
          </li>
          <li>
            <a href="/reference" target="_blank" rel="noopener noreferrer">
              API Reference
            </a>
          </li>
        </ul>
      </div>

      {showConfirmModal && (
        <Modal
          id="modal-confirm-unsandboxed"
          title="Run agents without a sandbox?"
          onClose={handleCancel}
          closeButtonId="btn-close-unsandboxed-modal"
        >
          <div className="unsandboxed-modal-content">
            <p className="unsandboxed-modal-warning">
              Coding agents will execute directly on this machine without
              container isolation. The agent will have access to your local
              filesystem, network, and environment.
            </p>
            <p className="text-muted text-footnote mt-2">
              Only enable this if you trust the repository and model, or if you
              do not have <code>sbx</code> installed. You can also enable this
              per-process with <code>X_FACTORY_ALLOW_UNSANDBOXED=1</code>.
            </p>
          </div>
          <ModalFooter>
            <button
              type="button"
              className="btn btn-secondary"
              id="btn-cancel-unsandboxed"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warning"
              id="btn-confirm-unsandboxed"
              onClick={handleConfirm}
              disabled={isSavingUnsandboxed}
            >
              {isSavingUnsandboxed
                ? "Enabling…"
                : "Enable Unsandboxed Execution"}
            </button>
          </ModalFooter>
        </Modal>
      )}
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
  const { data: descriptors = [] } = useProviderDescriptors();

  // The registry renders one combo line per project, so every project's wiring
  // is derived here — once — and the identity read is ONE hook call for the
  // whole table (#133 story 34). Each connection is keyed by its own
  // configuration, so no two projects can share an identity.
  const rows = projects.map((project) => ({
    project,
    integrity: deriveConnectionIntegrity(project, descriptors),
  }));
  const slotsByRow = useConnectionLines(
    rows.map((row) => ({
      slots: comboSlots(row.integrity),
      targets: recordedConnectionIdentityTargets(
        row.integrity,
        undefined,
        descriptors,
      ),
    })),
  );

  return (
    <div id="tab-trackers" className="settings-pane active">
      <div className="connections-header">
        <div>
          <h3>{CONNECTIONS_COPY.registryTitle}</h3>
          <p className="text-muted">{CONNECTIONS_COPY.registrySubtitle}</p>
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
          <span>{CONNECTIONS_COPY.onboardProject}</span>
        </button>
      </div>

      <div className="connections-registry-container">
        <table className="connections-table">
          <thead>
            <tr>
              <th>{CONNECTIONS_COPY.registryColumnProject}</th>
              <th>{CONNECTIONS_COPY.registryColumnConnections}</th>
              <th>{CONNECTIONS_COPY.registryColumnStatus}</th>
              <th className="align-right">
                {CONNECTIONS_COPY.registryColumnAction}
              </th>
            </tr>
          </thead>
          <tbody id="connections-registry-tbody">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="text-muted text-center p-4">
                  {CONNECTIONS_COPY.registryLoading}
                </td>
              </tr>
            ) : projects.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted text-center p-4">
                  {CONNECTIONS_COPY.registryEmpty}
                </td>
              </tr>
            ) : (
              rows.map(({ project: p, integrity }, index) => {
                const slots = slotsByRow[index] ?? [];

                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="connections-cell">
                      <ConnectionComboLine
                        slots={slots}
                        tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
                        descriptors={descriptors}
                        className="connection-combo-line--compact"
                      />
                      {integrity.hasIntegrityFailure && (
                        <RetryAction
                          label={CONNECTIONS_COPY.reconnect}
                          onRetry={onOnboardProject}
                        />
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${p.archived ? "badge-status-archived" : "badge-status-active"}`}
                      >
                        {p.archived
                          ? CONNECTIONS_COPY.registryStatusArchived
                          : CONNECTIONS_COPY.registryStatusActive}
                      </span>
                    </td>
                    <td className="align-right">
                      <Link
                        to={`/projects/${encodeURIComponent(p.id)}`}
                        className="project-link"
                      >
                        {CONNECTIONS_COPY.registryAction}
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

/** Settings › Models (#277, #278): model connections, then the roles that use them. */
function ModelsTabContent() {
  return (
    <div id="tab-models" className="settings-pane active">
      <ModelConnectionsPanel />
      <RolesPanel />
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

  // The open pane is the URL's `?tab=`, so a link can open one directly.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = settingsTabFromParam(searchParams.get("tab"));
  const setActiveTab = (tab: SettingsTab) =>
    setSearchParams({ tab }, { replace: true });
  const {
    theme: currentTheme,
    appearance: currentAppearance,
    setAppearance,
  } = useTheme();

  const handleUpdateAppearance = async (appearance: AppearanceSetting) => {
    setAppearance(appearance);
    await saveSettingsMutation.mutateAsync({ appearance });
  };

  // The Theme choice is separate from Appearance (#249): it changes colour and
  // font tokens only, and only the theme is saved.
  const handleUpdateTheme = async (theme: ThemeName) => {
    setTheme(resolveInitialTheme(theme));
    await saveSettingsMutation.mutateAsync({ theme });
  };

  const handleUpdateUnsandboxed = async (enabled: boolean) => {
    await saveSettingsMutation.mutateAsync({ allowUnsandboxed: enabled });
  };

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
              onApplyTheme={handleUpdateTheme}
              currentAppearance={currentAppearance}
              onApplyAppearance={handleUpdateAppearance}
              allowUnsandboxed={Boolean(settings?.allowUnsandboxed)}
              onUpdateUnsandboxed={handleUpdateUnsandboxed}
              isSavingUnsandboxed={saveSettingsMutation.isPending}
            />
          )}

          {activeTab === "trackers" && (
            <ConnectionsTabContent
              projects={projects}
              isLoading={isProjectsLoading}
              onOnboardProject={openOnboardingModal}
            />
          )}

          {activeTab === "models" && <ModelsTabContent />}

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
