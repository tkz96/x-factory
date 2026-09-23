// src/frontend/components/projects/ReadinessBanner.tsx — Tooling & Environment Readiness Banner (XFM-48).

import "./ReadinessBanner.css";

import { useReadiness } from "../../hooks/useQueries.js";

export function ReadinessBanner() {
  const { data: readiness, isLoading, refetch, isRefetching } = useReadiness();

  if (isLoading) {
    return (
      <div className="readiness-banner card">
        <span className="text-muted">
          Checking system and project readiness…
        </span>
      </div>
    );
  }

  const isReady = readiness?.ready !== false;

  return (
    <div className={`readiness-banner card ${isReady ? "ready" : "warning"}`}>
      <div className="readiness-content">
        <span
          className={`status-dot status-dot-sm ${isReady ? "online" : "offline"}`}
        />
        <div>
          <strong className="readiness-title">
            {isReady
              ? "Tooling & Environment Ready"
              : "Readiness Issues Detected"}
          </strong>
          <span className="text-muted readiness-desc">
            {isReady
              ? "All required CLI tools, Git worktree isolation, and credentials verified."
              : "Some prerequisites or CLI tools are missing. Review below."}
          </span>
        </div>
      </div>

      <button
        type="button"
        id="btn-recheck-readiness"
        className="btn-secondary btn-sm"
        onClick={() => refetch()}
        disabled={isRefetching}
      >
        <svg
          className={`icon icon-sm ${isRefetching ? "spin" : ""}`}
          aria-hidden="true"
        >
          <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
        </svg>
        <span>{isRefetching ? "Re-checking…" : "Re-check Readiness"}</span>
      </button>
    </div>
  );
}
