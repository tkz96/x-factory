// src/frontend/components/projects/ReadinessBanner.tsx — Readiness banner (XFM-48): names exactly what was checked (#283).

import "./ReadinessBanner.css";

import { useReadiness } from "../../hooks/useQueries.js";
import { Button } from "../ui/Button.js";

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

  const checks = readiness?.checks ?? [];
  const attention = checks.filter((check) => check.status !== "pass");
  const isReady = readiness?.ready !== false && attention.length === 0;
  const checkedNames = checks.map((check) => check.name).join(", ");

  return (
    <div className={`readiness-banner card ${isReady ? "ready" : "warning"}`}>
      <div className="readiness-content">
        <span
          className={`status-dot status-dot-sm ${isReady ? "online" : "offline"}`}
        />
        <div>
          <strong className="readiness-title">
            {isReady ? "Ready" : "Needs attention"}
          </strong>
          {isReady ? (
            <span className="text-muted readiness-desc">
              {checkedNames
                ? `Checked: ${checkedNames}.`
                : "Database and background worker are running."}
            </span>
          ) : (
            <ul className="readiness-issues">
              {attention.map((check) => (
                <li key={check.name}>
                  <strong>{check.name}:</strong> {check.message}
                </li>
              ))}
              {attention.length === 0 && (
                <li>Database or background worker is unavailable.</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <Button
        id="btn-recheck-readiness"
        variant="secondary"
        size="sm"
        isDisabled={isRefetching}
        onPress={() => refetch()}
      >
        <svg
          className={`icon icon-sm ${isRefetching ? "icon-spin" : ""}`}
          aria-hidden="true"
        >
          <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
        </svg>
        <span>{isRefetching ? "Re-checking…" : "Re-check Readiness"}</span>
      </Button>
    </div>
  );
}
