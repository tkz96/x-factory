// src/frontend/views/SettingsView.tsx — Settings in the System Settings layout (#266, spec #241).
//
// A category list beside a detail pane. The open category is the URL's `?tab=`
// so a link can open one directly. At phone width the list and the pane take
// turns: a category pushes its pane, and the pane's "Settings" link goes back.

import "./SettingsView.css";

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Project } from "../../shared/types.js";
import { ConnectionComboLine } from "../components/connections/ConnectionComboLine.js";
import { comboTone } from "../components/connections/connection-state.js";
import {
  CONNECTIONS_COPY,
  STATUS_COPY,
} from "../components/feedback/copy-map.js";
import { RetryAction } from "../components/feedback/RetryAction.js";
import { AlertDialog } from "../components/overlays/AlertDialog.js";
import {
  comboSlots,
  deriveConnectionIntegrity,
  REQUIRED_POST_CREATION_ROLES,
  recordedConnectionIdentityTargets,
} from "../components/projects/connection-integrity.js";
import { AccessibilitySettings } from "../components/settings/AccessibilitySettings.js";
import { DesktopNotificationsSetting } from "../components/settings/DesktopNotificationsSetting.js";
import { ModelConnectionsPanel } from "../components/settings/ModelConnectionsPanel.js";
import { RolesPanel } from "../components/settings/RolesPanel.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Icon } from "../components/ui/Icon.js";
import {
  ListGroup,
  ListGroupRow,
  ListGroupValue,
} from "../components/ui/ListGroup.js";
import { PlaceholderRows } from "../components/ui/ListRow.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { SwitchControl } from "../components/ui/SwitchControl.js";
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

type SettingsTab =
  | "general"
  | "accessibility"
  | "trackers"
  | "models"
  | "git"
  | "diagnostics"
  | "help";

/** The categories, in the order the list shows them (#266). */
const SETTINGS_CATEGORIES: readonly {
  id: SettingsTab;
  label: string;
  icon: string;
}[] = [
  { id: "general", label: "General", icon: "icon-settings" },
  { id: "accessibility", label: "Accessibility", icon: "icon-eye" },
  { id: "trackers", label: "Connections", icon: "icon-layers" },
  { id: "models", label: "Models", icon: "icon-code" },
  { id: "git", label: "Git", icon: "icon-git-branch" },
  { id: "diagnostics", label: "Diagnostics", icon: "icon-check-circle-2" },
  { id: "help", label: "Help", icon: "icon-book-open" },
];

/** The settings tabs the `?tab=` query string may open (#278 links straight to Models). */
const SETTINGS_TABS: readonly SettingsTab[] = SETTINGS_CATEGORIES.map(
  (category) => category.id,
);

/** Where the app keeps everything on disk (src/paths.ts); shown, never edited. */
const DATA_DIRECTORY_DISPLAY = "~/.x-factory";

/** Where a run's worktree lives, as a path pattern; shown, never edited. */
const WORKTREE_PATH_DISPLAY = "~/.x-factory/projects/:id/worktrees/:runId";

function settingsTabFromParam(value: string | null): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? "general";
}

interface DiagnosticStatusProps {
  status: "healthy" | "unavailable";
}

/** The health of one diagnostic service, as a badge in the row's trailing slot. */
function DiagnosticStatus({ status }: DiagnosticStatusProps) {
  return (
    <Badge tone={status === "healthy" ? "success" : "error"}>
      {status === "healthy" ? STATUS_COPY.healthy : STATUS_COPY.unavailable}
    </Badge>
  );
}

interface DiagnosticsTabContentProps {
  isLoading: boolean;
  diagnostics: ReturnType<typeof useDiagnostics>["data"];
}

/**
 * Diagnostics, as two inset groups: the services, then the job queue,
 * each row trailing the value it reports.
 */
function DiagnosticsTabContent({
  isLoading,
  diagnostics,
}: DiagnosticsTabContentProps) {
  if (isLoading) {
    return <PlaceholderRows count={3} group />;
  }

  const workerHealthy = diagnostics?.worker.status === "healthy";
  const staleJobs = diagnostics?.database.jobs.stale ?? 0;

  return (
    <>
      <ListGroup title="Services">
        <ListGroupRow
          title="API"
          subtitle={`Uptime ${diagnostics?.system.uptime ?? 0}s`}
          trailing={<DiagnosticStatus status="healthy" />}
        />
        <ListGroupRow
          title="Database"
          subtitle={`WAL mode · ${diagnostics?.database.runs.total ?? 0} runs`}
          trailing={<DiagnosticStatus status="healthy" />}
        />
        <ListGroupRow
          title="Worker fleet"
          subtitle={`${diagnostics?.worker.activeCount ?? 0} active worker(s)`}
          trailing={
            <DiagnosticStatus
              status={workerHealthy ? "healthy" : "unavailable"}
            />
          }
        />
      </ListGroup>

      <ListGroup title="Job queue">
        <ListGroupRow
          title="Active jobs"
          trailing={diagnostics?.database.jobs.claimed ?? 0}
        />
        <ListGroupRow
          title="Pending jobs"
          trailing={diagnostics?.database.jobs.pending ?? 0}
        />
        <ListGroupRow
          title="Stale jobs"
          trailing={
            staleJobs > 0 ? (
              <span className="text-warning">{staleJobs}</span>
            ) : (
              staleJobs
            )
          }
        />
        <ListGroupRow
          title="Completed jobs"
          trailing={diagnostics?.database.jobs.completed ?? 0}
        />
      </ListGroup>
    </>
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

  // Turning the opt-in on asks first; turning it off saves at once (#266).
  const handleUnsandboxedChange = (next: boolean) => {
    if (next) {
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
    <div className="settings-pane">
      <h2 className="settings-pane-title text-title-2">General</h2>
      <p className="settings-pane-subtitle text-subhead">
        Appearance, notifications and the data folder.
      </p>

      {/* Theme and Appearance are the same control (#266): one segmented block,
          so both render at one height, type size and icon gap. Each trails its
          row's label. */}
      <ListGroup title="Appearance">
        <ListGroupRow
          title="Appearance"
          trailing={
            <SegmentedControl
              label="Appearance"
              value={currentAppearance}
              onChange={(id) => {
                const choice = APPEARANCE_CHOICES.find(
                  (item) => item.id === id,
                );
                if (choice !== undefined) onApplyAppearance(choice.id);
              }}
              options={APPEARANCE_CHOICES.map((choice) => ({
                id: choice.id,
                label: choice.label,
                icon: choice.icon,
                accessibleLabel: `${choice.label} Appearance`,
              }))}
            />
          }
        />
        <ListGroupRow
          title="Theme"
          trailing={
            <SegmentedControl
              label="Theme"
              value={currentTheme}
              onChange={(id) => {
                const choice = THEME_CHOICES.find((item) => item.id === id);
                if (choice !== undefined) onApplyTheme(choice.id);
              }}
              options={THEME_CHOICES.map((choice) => ({
                id: choice.id,
                label: choice.label,
                accessibleLabel: `${choice.label} Theme`,
              }))}
            />
          }
        />
      </ListGroup>

      <DesktopNotificationsSetting />

      <ListGroup
        title="Storage"
        footer="Runs, logs, settings and worktrees live under this folder."
      >
        <ListGroupRow
          title="Data folder"
          trailing={<ListGroupValue>{DATA_DIRECTORY_DISPLAY}</ListGroupValue>}
        />
      </ListGroup>

      <ListGroup
        title="Security"
        footer="Only enable this if you trust the repository and model, or if you do not have sbx installed. X_FACTORY_ALLOW_UNSANDBOXED=1 enables it for one process."
      >
        <ListGroupRow
          title="Run agents without a sandbox"
          subtitle="Runs the coding loop directly on the host machine when sbx is unavailable."
          trailing={
            <SwitchControl
              label="Run agents without a sandbox"
              hideLabel
              isSelected={allowUnsandboxed}
              isDisabled={isSavingUnsandboxed === true}
              onChange={handleUnsandboxedChange}
            />
          }
        />
      </ListGroup>

      <AlertDialog
        id="modal-confirm-unsandboxed"
        isOpen={showConfirmModal}
        onClose={handleCancel}
        title="Run agents without a sandbox?"
        description="Coding agents will execute directly on this machine without container isolation. The agent will have access to your local filesystem, network, and environment."
        confirmText={
          isSavingUnsandboxed ? "Enabling…" : "Enable Unsandboxed Execution"
        }
        cancelText="Cancel"
        variant="danger"
        isConfirmDisabled={isSavingUnsandboxed === true}
        onConfirm={handleConfirm}
      >
        <p className="text-muted text-footnote mt-2">
          Only enable this if you trust the repository and model, or if you do
          not have <code>sbx</code> installed. You can also enable this
          per-process with <code>X_FACTORY_ALLOW_UNSANDBOXED=1</code>.
        </p>
      </AlertDialog>
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
    <div className="settings-pane">
      <div className="settings-pane-head">
        <div>
          <h2 className="settings-pane-title text-title-2">Connections</h2>
          <p className="settings-pane-subtitle text-subhead">
            {CONNECTIONS_COPY.registrySubtitle}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="icon-plus"
          onPress={onOnboardProject}
        >
          {CONNECTIONS_COPY.onboardProject}
        </Button>
      </div>

      {isLoading ? (
        <PlaceholderRows count={3} group />
      ) : projects.length === 0 ? (
        <EmptyState title={CONNECTIONS_COPY.registryEmpty} headingLevel={3} />
      ) : (
        /* One inset group, one row per project: the project's name and
           its combo line lead, the status and the way in trail — no column
           headers and no horizontally scrolling table. The row's own name is
           the link, so the repair action a broken project needs can sit beside
           it without nesting a button inside an anchor. */
        <ListGroup title="Projects">
          {rows.map(({ project: p, integrity }, index) => {
            const slots = slotsByRow[index] ?? [];
            return (
              <ListGroupRow
                key={p.id}
                titleHref={`/projects/${encodeURIComponent(p.id)}`}
                title={p.name}
                subtitle={
                  <ConnectionComboLine
                    slots={slots}
                    tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
                    descriptors={descriptors}
                    className="connection-combo-line--compact"
                  />
                }
                trailing={
                  <>
                    {integrity.hasIntegrityFailure && (
                      <RetryAction
                        label={CONNECTIONS_COPY.reconnect}
                        onRetry={onOnboardProject}
                      />
                    )}
                    <Badge tone={p.archived ? "neutral" : "success"}>
                      {p.archived
                        ? CONNECTIONS_COPY.registryStatusArchived
                        : CONNECTIONS_COPY.registryStatusActive}
                    </Badge>
                    <Icon name="icon-chevron-right" size="sm" />
                  </>
                }
              />
            );
          })}
        </ListGroup>
      )}
    </div>
  );
}

/** Settings › Models (#277, #278): model connections, then the roles that use them. */
function ModelsTabContent() {
  return (
    <div className="settings-pane">
      <h2 className="settings-pane-title text-title-2">Models</h2>
      <p className="settings-pane-subtitle text-subhead">
        The connections that serve models, and the model each role uses.
      </p>
      <ModelConnectionsPanel />
      <RolesPanel />
    </div>
  );
}

/** Settings › Help (#266): the documentation and the API reference, at every width. */
function HelpTabContent() {
  return (
    <div className="settings-pane">
      <h2 className="settings-pane-title text-title-2">Help</h2>
      <p className="settings-pane-subtitle text-subhead">
        Guides for X-Factory and its API.
      </p>
      {/* Two rows, each an anchor with the same box, trailing the
          "opens elsewhere" mark. */}
      <ListGroup title="Guides">
        <ListGroupRow
          href="/docs"
          isExternal
          title="Documentation"
          trailing={<Icon name="icon-arrow-up-right" size="sm" />}
        />
        <ListGroupRow
          href="/reference"
          isExternal
          title="API Reference"
          trailing={<Icon name="icon-arrow-up-right" size="sm" />}
        />
      </ListGroup>
    </div>
  );
}

function GitTabContent() {
  return (
    <div className="settings-pane">
      <h2 className="settings-pane-title text-title-2">Git</h2>
      <p className="settings-pane-subtitle text-subhead">
        Where run worktrees are stored.
      </p>
      <ListGroup title="Worktrees">
        <ListGroupRow
          title="Worktree path"
          trailing={<ListGroupValue>{WORKTREE_PATH_DISPLAY}</ListGroupValue>}
        />
      </ListGroup>
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
  const [searchParams] = useSearchParams();
  const activeTab = settingsTabFromParam(searchParams.get("tab"));
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

  const hasPushedPane = searchParams.has("tab");

  return (
    <section id="area-settings" className="area-view active">
      <div className="settings-layout" data-pushed={String(hasPushedPane)}>
        <nav aria-label="Settings categories" className="settings-categories">
          <ul className="settings-category-list">
            {SETTINGS_CATEGORIES.map((category) => {
              const isCurrent = activeTab === category.id;
              return (
                <li key={category.id}>
                  <Link
                    to={`/settings?tab=${category.id}`}
                    className="ui-nav-item"
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <Icon name={category.icon} size="md" />
                    <span>{category.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="settings-detail">
          <Link to="/settings" className="settings-back">
            <Icon name="icon-arrow-left" size="sm" />
            <span>Settings</span>
          </Link>

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

          {activeTab === "accessibility" && (
            <div className="settings-pane">
              <h2 className="settings-pane-title text-title-2">
                Accessibility
              </h2>
              <p className="settings-pane-subtitle text-subhead">
                Text and transparency. Both apply to every screen.
              </p>
              <AccessibilitySettings />
            </div>
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
            <div className="settings-pane">
              <h2 className="settings-pane-title text-title-2">Diagnostics</h2>
              <p className="settings-pane-subtitle text-subhead">
                Real-time health status, database integrity, background worker
                fleet, and job telemetry.
              </p>

              <DiagnosticsTabContent
                isLoading={isDiagLoading}
                diagnostics={diagnostics}
              />
            </div>
          )}

          {activeTab === "help" && <HelpTabContent />}
        </div>
      </div>
    </section>
  );
}
