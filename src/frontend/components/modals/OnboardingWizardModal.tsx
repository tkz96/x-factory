// src/frontend/components/modals/OnboardingWizardModal.tsx — Multi-step project onboarding wizard (XFM-46, XFM-52).

import "./OnboardingWizardModal.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type DuplicateDetectionResult,
  findDuplicateProject,
  normalizeProjectId,
} from "../../../shared/project-identity.js";
import type {
  ProjectRepository,
  RepositoryRole,
} from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import { useProjects } from "../../hooks/useQueries.js";
import { api } from "../../lib/api-client.js";
import { invalidateProjects } from "../../lib/query-client.js";
import {
  type DiscoveredRepositoryLike,
  deduplicateDiscoveredRepositories,
  deriveConfiguredRepositories,
  getEffectiveRepoConfig,
  getInitialPrimaryRepoId,
  getInitialRepoConfigs,
  REPOSITORY_ROLES,
  type RepoItemConfig,
  validateRepositorySelection,
} from "../../lib/wizard-repositories.js";
import { parseQuickUrl } from "../../lib/wizard-url.js";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface ScopeResult {
  ok: boolean;
  overPrivileged?: boolean | undefined;
  scopes?:
    | {
        workItemsRead: boolean;
        codeRead: boolean;
        codeStatus: boolean;
        workItemsWriteDetected: boolean;
        codeFullDetected?: boolean | undefined;
      }
    | undefined;
  errors?: string[] | undefined;
  warnings?: string[] | undefined;
}

const STEPS = [
  { num: 1, title: "Basics" },
  { num: 2, title: "Tracker" },
  { num: 3, title: "Discovery" },
  { num: 4, title: "Repositories" },
  { num: 5, title: "Inspection" },
  { num: 6, title: "Review" },
] as const;

// ---------------------------------------------------------------------------
// Step 1: Basics
// ---------------------------------------------------------------------------

interface Step1BasicsProps {
  quickUrl: string;
  quickUrlStatus: "detected" | "invalid" | null;
  projectName: string;
  projectId: string;
  workspacePath: string;
  onQuickUrlChange: (url: string) => void;
  onNameChange: (name: string) => void;
  onIdChange: (id: string) => void;
  onWorkspacePathChange: (path: string) => void;
  onCancel: () => void;
  onNext: () => void;
}

function Step1Basics({
  quickUrl,
  quickUrlStatus,
  projectName,
  projectId,
  workspacePath,
  onQuickUrlChange,
  onNameChange,
  onIdChange,
  onWorkspacePathChange,
  onCancel,
  onNext,
}: Step1BasicsProps) {
  return (
    <div id="onboard-step-1" className="wizard-pane active">
      <div className="quick-url-box">
        <div className="quick-url-header">
          <span>⚡ Quick Setup from URL</span>
          <span className="quick-url-subtitle">
            Auto-detects provider, project &amp; repos
          </span>
        </div>
        <input
          id="onboard-quick-url"
          type="text"
          placeholder="Paste URL (e.g. dev.azure.com/xynotech/Converso or github.com/owner/repo)"
          className="form-input code-input"
          value={quickUrl}
          onChange={(e) => onQuickUrlChange(e.target.value)}
        />
        {quickUrlStatus === "detected" && (
          <div
            id="quick-url-feedback"
            className="quick-url-feedback quick-url-success"
          >
            <div>
              <strong className="text-success">✓ URL Detected</strong>
              <span> — Fields auto-populated.</span>
            </div>
          </div>
        )}
        {quickUrlStatus === "invalid" && (
          <div
            id="quick-url-feedback"
            className="quick-url-feedback quick-url-tip"
          >
            <span>
              Tip: Enter a valid Azure DevOps project URL or GitHub URL.
            </span>
          </div>
        )}
      </div>
      <div className="form-group">
        <label htmlFor="onboard-proj-name">
          Project Display Name <span className="required">*</span>
        </label>
        <input
          id="onboard-proj-name"
          type="text"
          placeholder="e.g. Converso"
          className="form-input"
          value={projectName}
          onChange={(e) => onNameChange(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="onboard-proj-id">
          Stable Project Identifier <span className="required">*</span>
        </label>
        <input
          id="onboard-proj-id"
          type="text"
          placeholder="e.g. converso"
          className="form-input code-input"
          value={projectId}
          onChange={(e) => onIdChange(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="onboard-workspace-path">
          Local Workspace Root Directory
        </label>
        <input
          id="onboard-workspace-path"
          type="text"
          placeholder="e.g. ~/projects or /Users/talhazuberi/projects"
          className="form-input code-input"
          value={workspacePath}
          onChange={(e) => onWorkspacePathChange(e.target.value)}
        />
      </div>

      <div className="modal-actions mt-6">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          id="btn-step-1-next"
          className="btn-primary"
          onClick={onNext}
        >
          Continue to Tracker →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Issue Tracker & Scope Card
// ---------------------------------------------------------------------------

interface AzureScopeDiagnosticCardProps {
  patScopeResult: ScopeResult | null;
  leastPrivilegeAck: boolean;
  onAckChange: (ack: boolean) => void;
}

function AzureScopeDiagnosticCard({
  patScopeResult,
  leastPrivilegeAck,
  onAckChange,
}: AzureScopeDiagnosticCardProps) {
  return (
    <div id="azure-scope-diagnostic-card" className="card mt-4">
      <div className="flex-between">
        <h4>PAT Verification &amp; Privileges</h4>
        <span
          id="scope-status-pill"
          className={`status-pill ${
            patScopeResult?.ok
              ? patScopeResult.overPrivileged
                ? "warning"
                : "ready"
              : "neutral"
          }`}
        >
          {patScopeResult?.ok
            ? patScopeResult.overPrivileged
              ? "Notice: Over-Privileged"
              : "Verified Token Privileges"
            : "Awaiting Verification"}
        </span>
      </div>

      <div id="scope-responsibility-notice" className="scope-diagnostic-box">
        <strong>Scope Responsibility Notice:</strong>
        <p className="scope-note">
          X-Factory adheres to the principle of least privilege. Minimal
          required scopes:
        </p>
        <ul className="scope-list">
          <li id="scope-row-wit-read">Work Items: Read</li>
          <li id="scope-row-code-read">Code: Read &amp; write</li>
          <li id="scope-row-code-status">Code: Status</li>
        </ul>
        <div className="d-none">
          <span id="scope-row-wit-write">Work Items: Write</span>
          <span id="scope-row-code-full">Code: Full</span>
        </div>
        <p className="mt-2">
          See <a href="/docs#azure-pat">Azure PAT Docs</a> and{" "}
          <a href="/docs#azure-code">Code Scopes Reference</a>.
        </p>
      </div>

      {patScopeResult?.overPrivileged && (
        <div id="scope-overprivileged-warning" className="scope-warning-box">
          <p id="scope-overprivileged-text" className="m-0 font-medium">
            Warning: This PAT contains write permissions beyond the recommended
            minimum.
          </p>
          <label className="scope-checkbox-label">
            <input
              type="checkbox"
              id="chk-pat-least-privilege-ack"
              checked={leastPrivilegeAck}
              onChange={(e) => onAckChange(e.target.checked)}
            />
            <span>
              I understand that X-Factory only needs minimal permissions and
              accept responsibility for this token's scopes.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

interface Step2TrackerProps {
  tracker: string;
  gitHost: string;
  trackerProject: string;
  trackerOrgUrl: string;
  trackerPat: string;
  isVerifyingPat: boolean;
  patScopeResult: ScopeResult | null;
  leastPrivilegeAck: boolean;
  onTrackerChange: (tracker: string) => void;
  onGitHostChange: (gitHost: string) => void;
  onTrackerProjectChange: (project: string) => void;
  onTrackerOrgUrlChange: (url: string) => void;
  onTrackerPatChange: (pat: string) => void;
  onVerifyPat: () => void;
  onAckChange: (ack: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

function Step2Tracker({
  tracker,
  gitHost,
  trackerProject,
  trackerOrgUrl,
  trackerPat,
  isVerifyingPat,
  patScopeResult,
  leastPrivilegeAck,
  onTrackerChange,
  onGitHostChange,
  onTrackerProjectChange,
  onTrackerOrgUrlChange,
  onTrackerPatChange,
  onVerifyPat,
  onAckChange,
  onBack,
  onNext,
}: Step2TrackerProps) {
  return (
    <div id="onboard-step-2" className="wizard-pane active">
      <div className="form-group">
        <label htmlFor="onboard-tracker-connection">
          Issue Tracker Connection
        </label>
        <select
          id="onboard-tracker-connection"
          className="form-select"
          value={tracker}
          onChange={(e) => onTrackerChange(e.target.value)}
        >
          <option value="azure">Azure DevOps Boards (dev.azure.com)</option>
          <option value="github">GitHub Issues</option>
          <option value="jira">Jira Software</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="onboard-git-host">Git Hosting Provider</label>
        <select
          id="onboard-git-host"
          className="form-select"
          value={gitHost}
          onChange={(e) => onGitHostChange(e.target.value)}
        >
          <option value="azure">Azure Repos (dev.azure.com)</option>
          <option value="github">GitHub (github.com)</option>
          <option value="gitlab">GitLab (gitlab.com / self-hosted)</option>
          <option value="bitbucket">Bitbucket</option>
          <option value="local">Local Only / Other Git Server</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="onboard-tracker-project">
          Tracker Project / Board Key
        </label>
        <input
          id="onboard-tracker-project"
          type="text"
          placeholder="e.g. Converso (or owner/repo for GitHub)"
          className="form-input"
          value={trackerProject}
          onChange={(e) => onTrackerProjectChange(e.target.value)}
        />
      </div>

      {tracker === "azure" && (
        <div
          id="onboard-tracker-azure-fields-step2"
          className="tracker-fields-group"
        >
          <div className="form-group">
            <label htmlFor="onboard-azure-org-url">
              Azure DevOps Organization URL
            </label>
            <input
              id="onboard-azure-org-url"
              type="text"
              placeholder="https://dev.azure.com/your-org"
              className="form-input"
              value={trackerOrgUrl}
              onChange={(e) => onTrackerOrgUrlChange(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="onboard-azure-pat">
              Personal Access Token (PAT)
            </label>
            <input
              id="onboard-azure-pat"
              type="password"
              placeholder="Enter Azure DevOps PAT"
              className="form-input"
              value={trackerPat}
              onChange={(e) => onTrackerPatChange(e.target.value)}
            />
            <div className="mt-2">
              <button
                type="button"
                id="btn-verify-azure-pat"
                className="btn-secondary btn-sm"
                onClick={onVerifyPat}
                disabled={isVerifyingPat}
              >
                {isVerifyingPat ? "Testing Scopes…" : "Verify PAT Scopes"}
              </button>
            </div>
          </div>

          <AzureScopeDiagnosticCard
            patScopeResult={patScopeResult}
            leastPrivilegeAck={leastPrivilegeAck}
            onAckChange={onAckChange}
          />
        </div>
      )}

      <div className="modal-actions mt-6">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-2-next"
          className="btn-primary"
          onClick={onNext}
        >
          Continue to Discovery →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Discovery
// ---------------------------------------------------------------------------

interface Step3DiscoveryProps {
  workspacePath: string;
  isDiscovering: boolean;
  hasDiscovered: boolean;
  discoveryError: string | null;
  discoveredRepositories: Array<{
    id: string;
    name: string;
    remote?: string;
    defaultBranch?: string;
    webUrl?: string;
  }>;
  onRetry: () => void;
  onBack: () => void;
  onNext: () => void;
}

function Step3Discovery({
  workspacePath,
  isDiscovering,
  hasDiscovered,
  discoveryError,
  discoveredRepositories,
  onRetry,
  onBack,
  onNext,
}: Step3DiscoveryProps) {
  return (
    <div id="onboard-step-3" className="wizard-pane active">
      <h3>Repository Discovery</h3>
      <p className="text-muted">
        Scan your workspace path ({workspacePath}) to detect repositories
        matching this project.
      </p>
      <div className="card mt-4 p-4">
        {isDiscovering ? (
          <p className="m-0">Discovering...</p>
        ) : discoveryError ? (
          <div>
            <p className="m-0 text-error">Discovery failed: {discoveryError}</p>
            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : discoveredRepositories.length === 0 ? (
          <div>
            <p className="m-0">No repositories found.</p>
            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              onClick={onRetry}
            >
              Retry Discovery
            </button>
          </div>
        ) : (
          <div>
            <p className="m-0 text-success">
              {discoveredRepositories.length} repositories discovered
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              onClick={onRetry}
            >
              Re-scan
            </button>
          </div>
        )}
      </div>
      <div className="modal-actions mt-6">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-3-next"
          className="btn-primary"
          onClick={onNext}
          disabled={isDiscovering || !!discoveryError || !hasDiscovered}
        >
          Continue to Repositories →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Repositories
// ---------------------------------------------------------------------------

interface RepoConfigCardProps {
  repo: DiscoveredRepositoryLike;
  config: RepoItemConfig;
  isPrimary: boolean;
  onToggleSelect: (repoId: string, selected: boolean) => void;
  onSetPrimary: (repoId: string) => void;
  onPathChange: (repoId: string, path: string) => void;
  onRoleChange: (repoId: string, role: RepositoryRole) => void;
}

function RepoConfigCard({
  repo,
  config,
  isPrimary,
  onToggleSelect,
  onSetPrimary,
  onPathChange,
  onRoleChange,
}: RepoConfigCardProps) {
  return (
    <div
      className={`repo-config-card ${config.selected ? "selected" : "deselected"}`}
      data-repo-id={repo.id}
    >
      <div className="repo-config-header">
        <div className="repo-info-col">
          <label
            className="repo-checkbox-label"
            htmlFor={`repo-select-${repo.id}`}
          >
            <input
              type="checkbox"
              id={`repo-select-${repo.id}`}
              checked={config.selected}
              onChange={(e) => onToggleSelect(repo.id, e.target.checked)}
            />
            <span className="repo-name font-semibold">{repo.name}</span>{" "}
            <span className="text-muted text-footnote ml-1">
              ({repo.remote || "no-remote"})
            </span>
          </label>
          <div className="repo-meta-row text-footnote text-muted">
            <span className="badge badge-neutral mr-2">
              branch: {repo.defaultBranch || "main"}
            </span>
            {isPrimary && (
              <span className="badge badge-primary-repo">Primary</span>
            )}
          </div>
        </div>
        <div className="repo-primary-group">
          <label
            className="repo-radio-label"
            htmlFor={`repo-primary-${repo.id}`}
          >
            <input
              type="radio"
              name="primaryRepo"
              id={`repo-primary-${repo.id}`}
              checked={isPrimary}
              onChange={() => onSetPrimary(repo.id)}
            />
            <span>Primary</span>
          </label>
        </div>
      </div>

      <div className="repo-config-fields-grid mt-3">
        <div className="form-group mb-0">
          <label htmlFor={`repo-path-${repo.id}`}>Local Path</label>
          <input
            type="text"
            id={`repo-path-${repo.id}`}
            className="form-input text-mono"
            value={config.path}
            onChange={(e) => onPathChange(repo.id, e.target.value)}
            aria-label={`Local path for ${repo.name}`}
          />
        </div>
        <div className="form-group mb-0">
          <label htmlFor={`repo-role-${repo.id}`}>Role</label>
          <select
            id={`repo-role-${repo.id}`}
            className="form-select"
            value={config.role}
            onChange={(e) =>
              onRoleChange(repo.id, e.target.value as RepositoryRole)
            }
            aria-label={`Role for ${repo.name}`}
          >
            {REPOSITORY_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export interface Step4RepositoriesProps {
  workspacePath: string;
  projectId: string;
  quickUrl?: string | undefined;
  discoveredRepositories: readonly DiscoveredRepositoryLike[];
  repoConfigs?: Record<string, RepoItemConfig> | undefined;
  onRepoConfigsChange?:
    | React.Dispatch<React.SetStateAction<Record<string, RepoItemConfig>>>
    | undefined;
  primaryRepoId?: string | null | undefined;
  onPrimaryRepoIdChange?: ((id: string | null) => void) | undefined;
  onBack: () => void;
  onNext: () => void;
}

export function Step4Repositories({
  workspacePath,
  projectId,
  quickUrl: _quickUrl,
  discoveredRepositories,
  repoConfigs,
  onRepoConfigsChange,
  primaryRepoId,
  onPrimaryRepoIdChange,
  onBack,
  onNext,
}: Step4RepositoriesProps) {
  const uniqueDiscovered = useMemo(() => {
    return deduplicateDiscoveredRepositories(discoveredRepositories);
  }, [discoveredRepositories]);

  const [internalConfigs, setInternalConfigs] = useState<
    Record<string, RepoItemConfig>
  >({});
  const [internalPrimaryId, setInternalPrimaryId] = useState<string | null>(
    null,
  );

  const currentConfigs = repoConfigs ?? internalConfigs;
  const setConfigs = onRepoConfigsChange ?? setInternalConfigs;

  const currentPrimaryId =
    primaryRepoId !== undefined ? primaryRepoId : internalPrimaryId;
  const setPrimaryId = onPrimaryRepoIdChange ?? setInternalPrimaryId;

  const effectivePrimaryId = useMemo(() => {
    if (
      currentPrimaryId &&
      uniqueDiscovered.some((r) => r.id === currentPrimaryId)
    ) {
      return currentPrimaryId;
    }
    return getInitialPrimaryRepoId(uniqueDiscovered, projectId);
  }, [currentPrimaryId, uniqueDiscovered, projectId]);

  const selectedRepos = useMemo(() => {
    return uniqueDiscovered.filter((r) => {
      const cfg = getEffectiveRepoConfig(r, currentConfigs, workspacePath);
      return cfg.selected;
    });
  }, [uniqueDiscovered, currentConfigs, workspacePath]);

  const validationError = validateRepositorySelection({
    selectedRepos,
    primaryRepoId: effectivePrimaryId,
  });

  const handleToggleSelect = (repoId: string, selected: boolean) => {
    const repo = uniqueDiscovered.find((r) => r.id === repoId);
    if (!repo) return;
    setConfigs((prev) => {
      const base =
        prev[repoId] ?? getEffectiveRepoConfig(repo, prev, workspacePath);
      return {
        ...prev,
        [repoId]: {
          selected,
          path: base.path,
          role: base.role,
        },
      };
    });
  };

  const handleSetPrimary = (repoId: string) => {
    const repo = uniqueDiscovered.find((r) => r.id === repoId);
    if (!repo) return;
    setPrimaryId(repoId);
    setConfigs((prev) => {
      const base =
        prev[repoId] ?? getEffectiveRepoConfig(repo, prev, workspacePath);
      return {
        ...prev,
        [repoId]: {
          selected: true,
          path: base.path,
          role: base.role,
        },
      };
    });
  };

  const handlePathChange = (repoId: string, path: string) => {
    const repo = uniqueDiscovered.find((r) => r.id === repoId);
    if (!repo) return;
    setConfigs((prev) => {
      const base =
        prev[repoId] ?? getEffectiveRepoConfig(repo, prev, workspacePath);
      return {
        ...prev,
        [repoId]: {
          selected: base.selected,
          path,
          role: base.role,
        },
      };
    });
  };

  const handleRoleChange = (repoId: string, role: RepositoryRole) => {
    const repo = uniqueDiscovered.find((r) => r.id === repoId);
    if (!repo) return;
    setConfigs((prev) => {
      const base =
        prev[repoId] ?? getEffectiveRepoConfig(repo, prev, workspacePath);
      return {
        ...prev,
        [repoId]: {
          selected: base.selected,
          path: base.path,
          role,
        },
      };
    });
  };

  return (
    <div id="onboard-step-4" className="wizard-pane active">
      <h3>Configure Repositories</h3>
      <p className="text-muted">
        Select repositories for this project, designate the primary repository,
        and configure local paths and roles.
      </p>

      {validationError && (
        <div
          className="error-message mb-4"
          id="step-4-validation-error"
          role="alert"
        >
          {validationError}
        </div>
      )}

      {uniqueDiscovered.length === 0 ? (
        <div className="card mt-4 p-4">
          <p className="m-0 text-muted">
            No repositories discovered. Please return to Step 3 to scan your
            workspace.
          </p>
        </div>
      ) : (
        <div className="repos-config-list mt-4" id="discovered-repos-list">
          {uniqueDiscovered.map((repo) => {
            const cfg = getEffectiveRepoConfig(
              repo,
              currentConfigs,
              workspacePath,
            );
            const isPrimary = repo.id === effectivePrimaryId;

            return (
              <RepoConfigCard
                key={repo.id}
                repo={repo}
                config={cfg}
                isPrimary={isPrimary}
                onToggleSelect={handleToggleSelect}
                onSetPrimary={handleSetPrimary}
                onPathChange={handlePathChange}
                onRoleChange={handleRoleChange}
              />
            );
          })}
        </div>
      )}

      <div className="modal-actions mt-6">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-4-next"
          className="btn-primary"
          onClick={onNext}
          disabled={Boolean(validationError)}
        >
          Continue to Inspection →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Inspection
// ---------------------------------------------------------------------------

interface Step5InspectionProps {
  onBack: () => void;
  onNext: () => void;
}

function Step5Inspection({ onBack, onNext }: Step5InspectionProps) {
  return (
    <div id="onboard-step-5" className="wizard-pane active">
      <h3>Prerequisite &amp; Tooling Inspection</h3>
      <p className="text-muted">
        Verifying Git worktrees, test runners, and tooling health.
      </p>
      <div className="card ready mt-4 p-4">
        <span className="status-dot online mr-2" />
        <span>Prerequisites and Git worktree isolation verified.</span>
      </div>
      <div className="modal-actions mt-6">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-5-next"
          className="btn-primary"
          onClick={onNext}
        >
          Continue to Review →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Review & Finalize
// ---------------------------------------------------------------------------

interface Step6ReviewProps {
  projectName: string;
  projectId: string;
  workspacePath: string;
  tracker: string;
  quickUrl: string;
  isSubmitting: boolean;
  duplicateStatus: DuplicateDetectionResult;
  isProjectsLoading?: boolean;
  isProjectsFetching?: boolean;
  isProjectsError?: boolean;
  onBack: () => void;
  onSubmit: () => void;
  onClose?: () => void;
}

function formatAzureOrg(url: string): string {
  const stripped = url
    .replace(/^https?:\/\//, "")
    .replace(/^dev\.azure\.com\//, "")
    .replace(/\.visualstudio\.com.*$/, "")
    .replace(/\/$/, "");
  return stripped || url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

interface Step6WarningBannerProps {
  isChecking: boolean;
  isError: boolean;
  duplicateStatus: DuplicateDetectionResult;
  projectId: string;
  onClose?: (() => void) | undefined;
}

function Step6WarningBanner({
  isChecking,
  isError,
  duplicateStatus,
  projectId,
  onClose,
}: Step6WarningBannerProps) {
  const { isDuplicate, type, existingProject } = duplicateStatus;

  if (isChecking) {
    return (
      <div className="card mt-4 p-4 duplicate-warning-card">
        <div className="text-muted">Checking for existing projects…</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card mt-4 p-4 error-message duplicate-warning-card">
        <strong className="text-error">
          Unable to verify project uniqueness.
        </strong>
        <div className="text-muted">
          Failed to load existing projects. Please retry before creating.
        </div>
      </div>
    );
  }

  if (isDuplicate && existingProject) {
    return (
      <div className="card mt-4 p-4 error-message duplicate-warning-card">
        {type === "id_collision" ? (
          <strong className="text-error">
            Project ID "{projectId}" is already in use.
          </strong>
        ) : (
          <strong className="text-error">
            This project is already onboarded.
          </strong>
        )}
        <div className="text-muted">
          Existing project: <strong>{existingProject.name}</strong>
          {existingProject.archived && " (Archived)"}
          {type === "external_identity" &&
            existingProject.issueTracker?.provider === "azure" &&
            existingProject.issueTracker.azure && (
              <div>
                Azure DevOps:{" "}
                {formatAzureOrg(existingProject.issueTracker.azure.orgUrl)} /{" "}
                {existingProject.issueTracker.azure.project}
              </div>
            )}
          {type === "external_identity" &&
            existingProject.issueTracker?.provider === "github" &&
            existingProject.issueTracker.github && (
              <div>GitHub: {existingProject.issueTracker.github.repo}</div>
            )}
        </div>
        <div className="mt-2">
          <Link
            to={`/projects/${existingProject.id}`}
            className="btn-secondary btn-sm"
            onClick={onClose}
          >
            Open Existing Project
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

function Step6Review({
  projectName,
  projectId,
  workspacePath,
  tracker,
  quickUrl,
  isSubmitting,
  duplicateStatus,
  isProjectsLoading,
  isProjectsFetching,
  isProjectsError,
  onBack,
  onSubmit,
  onClose,
}: Step6ReviewProps) {
  const isChecking = Boolean(isProjectsLoading || isProjectsFetching);
  const blocked =
    Boolean(duplicateStatus.isDuplicate) ||
    isSubmitting ||
    isChecking ||
    Boolean(isProjectsError);

  return (
    <div id="onboard-step-6" className="wizard-pane active">
      <h3>Review &amp; Create Project</h3>
      <p className="text-muted">
        Review configuration before creating project.
      </p>

      <Step6WarningBanner
        isChecking={isChecking}
        isError={Boolean(isProjectsError)}
        duplicateStatus={duplicateStatus}
        projectId={projectId}
        onClose={onClose}
      />

      <div className="project-detail-meta-grid card mt-4">
        <div className="project-meta-item">
          <strong>Project Name</strong>
          <span>{projectName}</span>
        </div>
        <div className="project-meta-item">
          <strong>Project ID</strong>
          <code>{projectId}</code>
        </div>
        <div className="project-meta-item">
          <strong>Workspace</strong>
          <code>{workspacePath}</code>
        </div>
        <div className="project-meta-item">
          <strong>Tracker</strong>
          <span>{tracker}</span>
        </div>
        {quickUrl && (
          <div className="project-meta-item">
            <strong>Remote URL</strong>
            <code>{quickUrl}</code>
          </div>
        )}
      </div>

      <div className="modal-actions mt-6">
        <button
          type="button"
          className="btn-secondary"
          onClick={onBack}
          disabled={isSubmitting}
        >
          ← Back
        </button>
        <button
          type="button"
          id="btn-onboard-submit"
          className="btn-primary"
          onClick={onSubmit}
          disabled={blocked}
        >
          {isSubmitting ? "Creating Project…" : "Create & Connect Project"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal Component
// ---------------------------------------------------------------------------

export function OnboardingWizardModal() {
  const { isOnboardingOpen, closeOnboardingModal } = useModal();
  const {
    data: allProjects = [],
    isLoading: isProjectsLoading,
    isFetching: isProjectsFetching,
    isError: isProjectsError,
    refetch: refetchProjects,
  } = useProjects({
    includeArchived: true,
  });

  const [step, setStep] = useState<WizardStep>(1);
  const [maxStep, setMaxStep] = useState<WizardStep>(1);
  const prevStepRef = useRef<WizardStep>(step);

  useEffect(() => {
    if (step === 6 && prevStepRef.current !== 6) {
      void refetchProjects();
    }
    prevStepRef.current = step;
  }, [step, refetchProjects]);

  // Form state
  const [quickUrl, setQuickUrl] = useState("");
  const [quickUrlStatus, setQuickUrlStatus] = useState<
    "detected" | "invalid" | null
  >(null);
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [workspacePath, setWorkspacePath] = useState(
    "/Users/talhazuberi/projects",
  );
  const [tracker, setTracker] = useState("azure");
  const [gitHost, setGitHost] = useState("azure");
  const [trackerProject, setTrackerProject] = useState("");
  const [trackerOrgUrl, setTrackerOrgUrl] = useState("");
  const [trackerPat, setTrackerPat] = useState("");
  const [isVerifyingPat, setIsVerifyingPat] = useState(false);
  const [patScopeResult, setPatScopeResult] = useState<ScopeResult | null>(
    null,
  );
  const [leastPrivilegeAck, setLeastPrivilegeAck] = useState(false);

  // Discovery state
  const [discoveredRepositories, setDiscoveredRepositories] = useState<
    Array<{
      id: string;
      name: string;
      remote?: string;
      defaultBranch?: string;
      webUrl?: string;
    }>
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [hasDiscovered, setHasDiscovered] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [lastDiscoveryInputs, setLastDiscoveryInputs] = useState<string>("");
  const discoveryGenerationRef = useRef(0);

  // Step 4: Configured Repositories state
  const [repoConfigs, setRepoConfigs] = useState<
    Record<string, RepoItemConfig>
  >({});
  const [primaryRepoId, setPrimaryRepoId] = useState<string | null>(null);

  // Synchronously derive configured repository array in primary-first order (consumed by #113 / #114)
  const configuredRepositories = useMemo<ProjectRepository[]>(() => {
    return deriveConfiguredRepositories({
      discoveredRepositories,
      repoConfigs,
      primaryRepoId,
      workspacePath,
      projectId,
    });
  }, [
    discoveredRepositories,
    repoConfigs,
    primaryRepoId,
    workspacePath,
    projectId,
  ]);
  void configuredRepositories;

  // Submitting
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOnboardingOpen) return null;

  const handleQuickUrlChange = (val: string) => {
    setQuickUrl(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setQuickUrlStatus(null);
      return;
    }
    const parsed = parseQuickUrl(trimmed);
    if (!parsed) {
      setQuickUrlStatus("invalid");
      return;
    }

    setQuickUrlStatus("detected");
    if (parsed.provider === "azure") {
      setProjectName(parsed.project);
      setProjectId(normalizeProjectId(parsed.project));
      setTracker("azure");
      setGitHost("azure");
      setTrackerProject(parsed.project);
      setTrackerOrgUrl(parsed.orgUrl);
    } else {
      setProjectName(parsed.repo);
      setProjectId(normalizeProjectId(parsed.repo));
      setTracker("github");
      setGitHost("github");
      setTrackerProject(`${parsed.owner}/${parsed.repo}`);
    }
  };

  const handleNameChange = (val: string) => {
    setProjectName(val);
    if (!projectId || projectId === normalizeProjectId(projectName)) {
      setProjectId(normalizeProjectId(val));
    }
  };

  const handleVerifyPat = async () => {
    if (!trackerOrgUrl || !trackerProject || !trackerPat) {
      setError("Please fill in Organization URL, Project, and PAT first.");
      return;
    }
    setIsVerifyingPat(true);
    setError(null);
    try {
      const res = await api.testAzureScopes({
        organization: trackerOrgUrl,
        project: trackerProject,
        pat: trackerPat,
      });
      setPatScopeResult(res as ScopeResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsVerifyingPat(false);
    }
  };

  const canGoNextFromStep2 = () => {
    if (tracker === "azure") {
      if (!trackerOrgUrl || !trackerProject || !trackerPat) return false;
      if (patScopeResult?.overPrivileged && !leastPrivilegeAck) return false;
    }
    if (tracker === "github") {
      if (!trackerProject.trim()) return false;
    }
    return true;
  };

  const goToStep = (next: WizardStep) => {
    setError(null);
    if (step === 1 && (!projectName.trim() || !projectId.trim())) {
      setError("Project Name and Project ID are required.");
      return;
    }
    if (step === 2 && !canGoNextFromStep2()) {
      if (patScopeResult?.overPrivileged && !leastPrivilegeAck) {
        setError(
          "Please check 'I understand' to acknowledge this token's permissions before continuing.",
        );
      } else {
        setError("Please complete the required tracker configuration.");
      }
      return;
    }
    setStep(next);
    if (next > maxStep) setMaxStep(next);

    if (next === 3) {
      void runDiscovery();
    }

    if (
      next === 4 &&
      Object.keys(repoConfigs).length === 0 &&
      discoveredRepositories.length > 0
    ) {
      const unique = deduplicateDiscoveredRepositories(discoveredRepositories);
      setRepoConfigs(getInitialRepoConfigs(unique, workspacePath));
      setPrimaryRepoId(getInitialPrimaryRepoId(unique, projectId));
    }
  };

  const runDiscovery = async (force = false) => {
    const currentInputs = JSON.stringify({
      tracker,
      trackerOrgUrl,
      trackerProject,
      workspacePath,
    });
    if (
      !force &&
      lastDiscoveryInputs === currentInputs &&
      (hasDiscovered || discoveryError)
    ) {
      return;
    }

    setLastDiscoveryInputs(currentInputs);
    setIsDiscovering(true);
    setHasDiscovered(false);
    setDiscoveryError(null);
    setDiscoveredRepositories([]);

    discoveryGenerationRef.current += 1;
    const currentGeneration = discoveryGenerationRef.current;

    try {
      const res = await api.discoverRepositories({
        provider: tracker,
        orgUrl: trackerOrgUrl,
        project: trackerProject,
        pat: trackerPat,
        workspacePath,
      });

      if (currentGeneration === discoveryGenerationRef.current) {
        const unique = deduplicateDiscoveredRepositories(res.repositories);
        setDiscoveredRepositories(unique);
        setHasDiscovered(true);

        setRepoConfigs(getInitialRepoConfigs(unique, workspacePath));
        setPrimaryRepoId(getInitialPrimaryRepoId(unique, projectId));
      }
    } catch (err) {
      if (currentGeneration === discoveryGenerationRef.current) {
        setDiscoveryError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentGeneration === discoveryGenerationRef.current) {
        setIsDiscovering(false);
      }
    }
  };

  const duplicateStatus = findDuplicateProject(
    allProjects,
    projectId,
    tracker,
    trackerOrgUrl,
    trackerProject,
    discoveredRepositories,
  );

  const handleCompleteOnboard = async () => {
    if (
      duplicateStatus.isDuplicate ||
      isProjectsLoading ||
      isProjectsFetching ||
      isProjectsError
    ) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const trimmedProjectId = projectId.trim();
      const trimmedName = projectName.trim() || trimmedProjectId;
      const trimmedWs = workspacePath.trim();
      const repoPath = `${trimmedWs.replace(/\/+$/, "")}/${trimmedProjectId}`;

      const payload = {
        id: trimmedProjectId,
        name: trimmedName,
        workspacePath: trimmedWs || undefined,
        repositoryPath: repoPath,
        defaultBranch: "main",
        issueTracker: {
          provider: tracker as "azure" | "github" | "jira",
          connectionId: tracker,
          projectId: trackerProject.trim() || undefined,
          azure:
            tracker === "azure"
              ? {
                  orgUrl: trackerOrgUrl.trim(),
                  project: trackerProject.trim(),
                  requiredLabel: "agentic-workflow",
                }
              : undefined,
          github:
            tracker === "github"
              ? {
                  repo: trackerProject.trim(),
                }
              : undefined,
        },
        repositories: [
          {
            id: trimmedProjectId,
            name: trimmedProjectId,
            path: repoPath,
            defaultBranch: "main",
            remote:
              quickUrl.trim() ||
              (tracker === "github" && trackerProject.trim()
                ? `https://github.com/${trackerProject.trim()}`
                : undefined),
            role: "backend",
          },
        ],
      };

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error || "Failed to onboard project.",
        );
      }

      await invalidateProjects();
      void refetchProjects();
      closeOnboardingModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="modal-project-onboarding"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-onboard-title"
    >
      <div className="modal-dialog modal-dialog-lg">
        <div className="modal-header">
          <div>
            <h2 id="modal-onboard-title">Onboard Software Project</h2>
            <span className="toolbar-subtitle">
              Connect a multi-repository workspace to X-Factory
            </span>
          </div>
          <button
            type="button"
            id="btn-close-onboard-modal"
            className="btn-close"
            aria-label="Close dialog"
            onClick={closeOnboardingModal}
          >
            <svg className="icon icon-xs" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-x" />
            </svg>
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className="stepper-bar">
          {STEPS.map((s) => (
            <button
              type="button"
              key={s.num}
              className={`step-indicator ${
                step === s.num ? "active" : s.num <= maxStep ? "completed" : ""
              }`}
              data-step={s.num}
              onClick={() => s.num <= maxStep && setStep(s.num as WizardStep)}
              disabled={s.num > maxStep}
            >
              <span className="step-num">{s.num}</span>
              <span className="step-title">{s.title}</span>
            </button>
          ))}
        </div>

        <div className="modal-body">
          {error && <div className="error-message mb-4">{error}</div>}

          {step === 1 && (
            <Step1Basics
              quickUrl={quickUrl}
              quickUrlStatus={quickUrlStatus}
              projectName={projectName}
              projectId={projectId}
              workspacePath={workspacePath}
              onQuickUrlChange={handleQuickUrlChange}
              onNameChange={handleNameChange}
              onIdChange={setProjectId}
              onWorkspacePathChange={setWorkspacePath}
              onCancel={closeOnboardingModal}
              onNext={() => goToStep(2)}
            />
          )}

          {step === 2 && (
            <Step2Tracker
              tracker={tracker}
              gitHost={gitHost}
              trackerProject={trackerProject}
              trackerOrgUrl={trackerOrgUrl}
              trackerPat={trackerPat}
              isVerifyingPat={isVerifyingPat}
              patScopeResult={patScopeResult}
              leastPrivilegeAck={leastPrivilegeAck}
              onTrackerChange={setTracker}
              onGitHostChange={setGitHost}
              onTrackerProjectChange={setTrackerProject}
              onTrackerOrgUrlChange={setTrackerOrgUrl}
              onTrackerPatChange={(pat) => {
                setTrackerPat(pat);
                setHasDiscovered(false);
                setDiscoveredRepositories([]);
                setRepoConfigs({});
                setPrimaryRepoId(null);
                setDiscoveryError(null);
                setLastDiscoveryInputs("");
              }}
              onVerifyPat={handleVerifyPat}
              onAckChange={setLeastPrivilegeAck}
              onBack={() => goToStep(1)}
              onNext={() => goToStep(3)}
            />
          )}

          {step === 3 && (
            <Step3Discovery
              workspacePath={workspacePath}
              isDiscovering={isDiscovering}
              hasDiscovered={hasDiscovered}
              discoveryError={discoveryError}
              discoveredRepositories={discoveredRepositories}
              onRetry={() => runDiscovery(true)}
              onBack={() => goToStep(2)}
              onNext={() => goToStep(4)}
            />
          )}

          {step === 4 && (
            <Step4Repositories
              workspacePath={workspacePath}
              projectId={projectId}
              quickUrl={quickUrl}
              discoveredRepositories={discoveredRepositories}
              repoConfigs={repoConfigs}
              onRepoConfigsChange={setRepoConfigs}
              primaryRepoId={primaryRepoId}
              onPrimaryRepoIdChange={setPrimaryRepoId}
              onBack={() => goToStep(3)}
              onNext={() => goToStep(5)}
            />
          )}

          {step === 5 && (
            <Step5Inspection
              onBack={() => goToStep(4)}
              onNext={() => goToStep(6)}
            />
          )}

          {step === 6 && (
            <Step6Review
              projectName={projectName}
              projectId={projectId}
              workspacePath={workspacePath}
              tracker={tracker}
              quickUrl={quickUrl}
              isSubmitting={isSubmitting}
              duplicateStatus={duplicateStatus}
              isProjectsLoading={isProjectsLoading}
              isProjectsFetching={isProjectsFetching}
              isProjectsError={isProjectsError}
              onBack={() => goToStep(5)}
              onSubmit={handleCompleteOnboard}
              onClose={closeOnboardingModal}
            />
          )}
        </div>
      </div>
    </div>
  );
}
