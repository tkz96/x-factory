// src/frontend/components/projects/TrackerSection.tsx — Dedicated Tracker Card & Scope Diagnostics (XFM-48).

import { useState } from "react";
import type { Project } from "../../../shared/types.js";
import { api } from "../../lib/api-client.js";
import "./TrackerSection.css";

interface TrackerSectionProps {
  project: Project;
}

export function TrackerSection({ project }: TrackerSectionProps) {
  const tracker = project.issueTracker;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    overPrivileged?: boolean | undefined;
    message?: string | undefined;
    details?: string | undefined;
  } | null>(null);

  if (!tracker) {
    return (
      <div id="project-tracker-section" className="project-tracker-card card">
        <h3>Issue Tracker Connection</h3>
        <p className="text-muted">
          No issue tracker connected to this project.
        </p>
      </div>
    );
  }

  const handleTestAzureScopes = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testAzureScopes({
        projectId: project.id,
      });
      setTestResult({
        ok: res.ok,
        overPrivileged: res.overPrivileged,
        message: res.ok
          ? "Connection and permissions verified."
          : "Verification failed. Review required scopes.",
        details: JSON.stringify(res.scopes, null, 2),
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div id="project-tracker-section" className="project-tracker-card card">
      <div className="tracker-section-header">
        <div>
          <h3 className="tracker-title">Issue Tracker Connection</h3>
          <p className="text-muted tracker-subtitle">
            Automated ticket ingestion and PR linking.
          </p>
        </div>
        <span className="role-badge">{tracker.provider}</span>
      </div>

      <div className="project-detail-meta-grid">
        <div className="project-meta-item">
          <strong>Provider</strong>
          <span>{tracker.provider}</span>
        </div>
        {tracker.azure?.orgUrl && (
          <div className="project-meta-item">
            <strong>Organization</strong>
            <span>{tracker.azure.orgUrl}</span>
          </div>
        )}
        {tracker.jira?.host && (
          <div className="project-meta-item">
            <strong>Host</strong>
            <span>{tracker.jira.host}</span>
          </div>
        )}
        {(tracker.azure?.project ||
          tracker.jira?.project ||
          tracker.github?.repo ||
          tracker.projectId) && (
          <div className="project-meta-item">
            <strong>Target</strong>
            <span>
              {tracker.azure?.project ||
                tracker.jira?.project ||
                tracker.github?.repo ||
                tracker.projectId}
            </span>
          </div>
        )}
        <div className="project-meta-item">
          <strong>Ingestion Label</strong>
          <code>
            {tracker.azure?.requiredLabel ||
              tracker.jira?.requiredLabel ||
              tracker.github?.requiredLabel ||
              "agentic-workflow"}
          </code>
        </div>
      </div>

      {tracker.provider === "azure" && (
        <div className="tracker-test-container">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleTestAzureScopes}
            disabled={testing}
          >
            {testing ? "Testing Scopes…" : "Test Azure DevOps Scopes"}
          </button>

          {testResult && (
            <div
              className={`tracker-test-result ${
                testResult.ok ? "success" : "danger"
              }`}
            >
              <strong>{testResult.message}</strong>
              {testResult.overPrivileged && (
                <div className="tracker-overprivileged-notice">
                  Notice: Token has broader access than the recommended minimum.
                </div>
              )}
              {testResult.details && (
                <pre className="tracker-test-details">{testResult.details}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
