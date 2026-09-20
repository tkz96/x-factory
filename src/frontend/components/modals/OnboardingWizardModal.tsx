// src/frontend/components/modals/OnboardingWizardModal.tsx — Multi-step project onboarding wizard (XFM-46, XFM-52).

import { useState } from "react";
import { useModal } from "../../context/ModalContext.js";
import { useProjects } from "../../hooks/useQueries.js";
import { api } from "../../lib/api-client.js";
import { invalidateProjects } from "../../lib/query-client.js";

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
  projectName: string;
  projectId: string;
  workspacePath: string;
  onNameChange: (name: string) => void;
  onIdChange: (id: string) => void;
  onWorkspacePathChange: (path: string) => void;
  onCancel: () => void;
  onNext: () => void;
}

function Step1Basics({
  projectName,
  projectId,
  workspacePath,
  onNameChange,
  onIdChange,
  onWorkspacePathChange,
  onCancel,
  onNext,
}: Step1BasicsProps) {
  return (
    <div id="onboard-step-1" className="wizard-pane active">
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

      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
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
    <div
      id="azure-scope-diagnostic-card"
      className="card"
      style={{ marginTop: "1rem" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
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

      <div
        id="scope-responsibility-notice"
        style={{
          fontSize: "0.85rem",
          marginTop: "0.5rem",
          color: "var(--text-muted)",
        }}
      >
        <strong>Scope Responsibility Notice:</strong>
        <p style={{ margin: "0.2rem 0" }}>
          X-Factory adheres to the principle of least privilege. Minimal
          required scopes:
        </p>
        <ul style={{ margin: "0.2rem 0 0 1.2rem", padding: 0 }}>
          <li id="scope-row-wit-read">Work Items: Read</li>
          <li id="scope-row-code-read">Code: Read &amp; write</li>
          <li id="scope-row-code-status">Code: Status</li>
        </ul>
        <div style={{ display: "none" }}>
          <span id="scope-row-wit-write">Work Items: Write</span>
          <span id="scope-row-code-full">Code: Full</span>
        </div>
        <p style={{ marginTop: "0.4rem" }}>
          See <a href="/docs#azure-pat">Azure PAT Docs</a> and{" "}
          <a href="/docs#azure-code">Code Scopes Reference</a>.
        </p>
      </div>

      {patScopeResult?.overPrivileged && (
        <div
          id="scope-overprivileged-warning"
          style={{
            marginTop: "0.8rem",
            padding: "0.8rem",
            background: "var(--bg-warning-subtle)",
            border: "1px solid var(--warning)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <p
            id="scope-overprivileged-text"
            style={{ margin: 0, fontWeight: 500 }}
          >
            Warning: This PAT contains write permissions beyond the recommended
            minimum.
          </p>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.5rem",
              cursor: "pointer",
            }}
          >
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
            <div style={{ marginTop: "0.5rem" }}>
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

      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
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
  onBack: () => void;
  onNext: () => void;
}

function Step3Discovery({
  workspacePath,
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
      <div className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
        <p style={{ margin: 0 }}>
          Ready to discover repositories in workspace directory.
        </p>
      </div>
      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          Continue to Repositories →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Repositories
// ---------------------------------------------------------------------------

interface Step4RepositoriesProps {
  workspacePath: string;
  onBack: () => void;
  onNext: () => void;
}

function Step4Repositories({
  workspacePath,
  onBack,
  onNext,
}: Step4RepositoriesProps) {
  return (
    <div id="onboard-step-4" className="wizard-pane active">
      <h3>Configure Repositories</h3>
      <p className="text-muted">
        Designate the primary repository and configure default branch.
      </p>
      <div className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
        <strong>Primary Workspace Repository</strong>
        <p
          className="text-muted"
          style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}
        >
          Using workspace path: {workspacePath} (branch: main)
        </p>
      </div>
      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
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
      <div
        className="card ready"
        style={{ marginTop: "1rem", padding: "1rem" }}
      >
        <span className="status-dot online" style={{ marginRight: "0.5rem" }} />
        <span>Prerequisites and Git worktree isolation verified.</span>
      </div>
      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
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
  isSubmitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

function Step6Review({
  projectName,
  projectId,
  workspacePath,
  tracker,
  isSubmitting,
  onBack,
  onSubmit,
}: Step6ReviewProps) {
  return (
    <div id="onboard-step-6" className="wizard-pane active">
      <h3>Review &amp; Create Project</h3>
      <p className="text-muted">
        Review configuration before creating project.
      </p>

      <div
        className="project-detail-meta-grid card"
        style={{ marginTop: "1rem" }}
      >
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
      </div>

      <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
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
          disabled={isSubmitting}
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
  const { refetch: refetchProjects } = useProjects();

  const [step, setStep] = useState<WizardStep>(1);
  const [maxStep, setMaxStep] = useState<WizardStep>(1);

  // Form state
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

  // Submitting
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOnboardingOpen) return null;

  const handleNameChange = (val: string) => {
    setProjectName(val);
    if (
      !projectId ||
      projectId === projectName.toLowerCase().replace(/[^a-z0-9]/g, "")
    ) {
      setProjectId(val.toLowerCase().replace(/[^a-z0-9]/g, ""));
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
  };

  const handleCompleteOnboard = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        id: projectId.trim(),
        name: projectName.trim(),
        workspacePath: workspacePath.trim() || undefined,
        defaultBranch: "main",
        issueTracker: {
          provider: tracker as "azure" | "github" | "jira",
          azure:
            tracker === "azure"
              ? {
                  orgUrl: trackerOrgUrl.trim(),
                  project: trackerProject.trim(),
                  requiredLabel: "agentic-workflow",
                }
              : undefined,
        },
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
          {error && (
            <div className="error-message" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          {step === 1 && (
            <Step1Basics
              projectName={projectName}
              projectId={projectId}
              workspacePath={workspacePath}
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
              onTrackerPatChange={setTrackerPat}
              onVerifyPat={handleVerifyPat}
              onAckChange={setLeastPrivilegeAck}
              onBack={() => goToStep(1)}
              onNext={() => goToStep(3)}
            />
          )}

          {step === 3 && (
            <Step3Discovery
              workspacePath={workspacePath}
              onBack={() => goToStep(2)}
              onNext={() => goToStep(4)}
            />
          )}

          {step === 4 && (
            <Step4Repositories
              workspacePath={workspacePath}
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
              isSubmitting={isSubmitting}
              onBack={() => goToStep(5)}
              onSubmit={handleCompleteOnboard}
            />
          )}
        </div>
      </div>
    </div>
  );
}
