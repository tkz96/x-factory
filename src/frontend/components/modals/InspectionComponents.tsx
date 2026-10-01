// src/frontend/components/modals/InspectionComponents.tsx — Subcomponents for Step 5 repository inspection (Issue #113).

import type { ProjectRepository } from "../../../shared/types.js";
import type {
  RepoInspectionResult,
  RepoInspectionStatus,
} from "../../hooks/useRepositoryInspection.js";

export interface InspectionStatusProps {
  repoId: string;
  status?: RepoInspectionStatus | undefined;
}

export function InspectionStatus({ repoId, status }: InspectionStatusProps) {
  if (!status || status === "inspecting" || status === "idle") {
    return (
      <span className="badge badge-neutral" data-testid={`status-${repoId}`}>
        Inspecting…
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="status-pill ready" data-testid={`status-${repoId}`}>
        <span className="status-dot online" />
        Ready
      </span>
    );
  }
  if (status === "pending_setup") {
    return (
      <span className="status-pill pending" data-testid={`status-${repoId}`}>
        <span className="status-dot warning" />
        Pending Setup
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="status-pill error" data-testid={`status-${repoId}`}>
        <span className="status-dot offline" />
        Invalid Directory
      </span>
    );
  }
  if (status === "api_error") {
    return (
      <span className="badge badge-error" data-testid={`status-${repoId}`}>
        Inspection Failed
      </span>
    );
  }
  return null;
}

export interface InspectionSummaryProps {
  repositories: ProjectRepository[];
  results: Record<string, RepoInspectionResult>;
  hasInspecting: boolean;
  hasApiError: boolean;
  hasConfigError: boolean;
}

export function InspectionSummary({
  repositories,
  results,
  hasInspecting,
  hasApiError,
  hasConfigError,
}: InspectionSummaryProps) {
  const allResults = repositories.map((r) => results[r.id]);
  const allReady =
    repositories.length > 0 &&
    !hasInspecting &&
    !hasApiError &&
    !hasConfigError &&
    allResults.every((res) => res?.status === "ready");
  const hasPendingSetup =
    !hasInspecting &&
    !hasApiError &&
    !hasConfigError &&
    allResults.some((res) => res?.status === "pending_setup");

  return (
    <div className="inspection-summary mb-4">
      {hasInspecting && (
        <div
          className="card mt-4 p-4"
          role="status"
          id="inspection-loading-banner"
        >
          <span className="status-dot warning mr-2" />
          <span>
            Inspecting selected repositories and verifying local tooling…
          </span>
        </div>
      )}

      {!hasInspecting && hasApiError && (
        <div
          className="error-message mt-4"
          role="alert"
          id="inspection-api-error-alert"
        >
          <strong>Inspection Failed:</strong> One or more repository inspections
          could not be completed due to an API or network error. Please resolve
          the issue or retry before continuing.
        </div>
      )}

      {!hasInspecting && !hasApiError && hasConfigError && (
        <div
          className="error-message mt-4"
          role="alert"
          id="inspection-config-error-alert"
        >
          <strong>Configuration Error:</strong> One or more selected
          repositories point to a directory that is not a valid Git repository.
          Return to Step 4 to correct the local path.
        </div>
      )}

      {!hasInspecting && !hasApiError && !hasConfigError && hasPendingSetup && (
        <div
          className="card pending mt-4 p-4"
          role="status"
          id="inspection-pending-setup-notice"
        >
          <span className="status-dot warning mr-2" />
          <span>
            One or more repositories require local checkout setup. This does not
            block project onboarding; you may continue to review.
          </span>
        </div>
      )}

      {!hasInspecting && !hasApiError && !hasConfigError && allReady && (
        <div
          className="card ready mt-4 p-4"
          role="status"
          id="inspection-all-ready-notice"
        >
          <span className="status-dot online mr-2" />
          <span>
            All selected repositories and prerequisites are verified and ready.
          </span>
        </div>
      )}
    </div>
  );
}

export interface InspectionCardProps {
  repo: ProjectRepository;
  result?: RepoInspectionResult | undefined;
  isPrimary: boolean;
  isInspecting: boolean;
  onRetry: () => void;
}

export function InspectionCard({
  repo,
  result,
  isPrimary,
  isInspecting,
  onRetry,
}: InspectionCardProps) {
  const cardStateClass =
    result?.status === "ready"
      ? "ready"
      : result?.status === "pending_setup"
        ? "pending"
        : result?.status === "error" || result?.status === "api_error"
          ? "error"
          : "";

  return (
    <div
      className={`inspection-card ${cardStateClass}`}
      id={`inspection-card-${repo.id}`}
      data-testid={`inspection-card-${repo.id}`}
    >
      <div className="inspection-header">
        <div className="repo-config-title-group">
          <div className="repo-meta-row">
            <strong>{repo.name}</strong>
            {repo.role && <span className="role-badge">{repo.role}</span>}
            {isPrimary && <span className="primary-badge">primary</span>}
          </div>
          <span className="text-muted text-xs code-text">{repo.path}</span>
        </div>

        <div>
          <InspectionStatus
            repoId={repo.id}
            status={result?.status ?? "inspecting"}
          />
        </div>
      </div>

      <div className="inspection-details mt-2">
        {result?.status === "ready" && (
          <div>
            <p className="text-success text-sm m-0">
              ✓ {result.message || "Repository verified and ready."}
            </p>
            {result.defaultBranch && (
              <div className="text-muted text-xs mt-1">
                Default branch: <code>{result.defaultBranch}</code>
              </div>
            )}
            {result.detectedCommands &&
              Object.keys(result.detectedCommands).length > 0 && (
                <div className="inspection-commands-grid mt-2">
                  {Object.entries(result.detectedCommands).map(
                    ([cmdKey, cmdVal]) => (
                      <div key={cmdKey} className="command-pill">
                        <span className="cmd-label">{cmdKey}:</span>{" "}
                        <code className="cmd-code">{cmdVal}</code>
                      </div>
                    ),
                  )}
                </div>
              )}
            {result.detectedTooling && result.detectedTooling.length > 0 && (
              <div className="text-muted text-xs mt-1">
                Detected tooling: {result.detectedTooling.join(", ")}
              </div>
            )}
          </div>
        )}

        {result?.status === "pending_setup" && (
          <div>
            <p className="text-warning text-sm m-0">
              ⏳ {result.message || `Local directory not found at ${repo.path}`}
            </p>
            <p className="text-muted text-xs mt-1 m-0">
              Local checkout not found. This repository must be cloned or
              initialized before running workflows, but project creation can
              proceed.
            </p>
          </div>
        )}

        {result?.status === "error" && (
          <div>
            <p className="text-danger text-sm m-0">
              ✕{" "}
              {result.message ||
                "Directory exists but is not a Git repository."}
            </p>
            <p className="text-muted text-xs mt-1 m-0">
              A non-Git directory cannot be used for this repository. Please
              return to Step 4 and update the local path.
            </p>
          </div>
        )}

        {result?.status === "api_error" && (
          <div>
            <p className="text-danger text-sm m-0">
              ⚠ Inspection API error:{" "}
              {result.apiError || "Could not connect to inspection endpoint."}
            </p>
            <p className="text-muted text-xs mt-1 m-0">
              Inspection failure is not a repository readiness status. Please
              check server status or retry.
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              data-testid={`btn-retry-${repo.id}`}
              onClick={onRetry}
              disabled={isInspecting}
            >
              Retry Inspection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
