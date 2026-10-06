// src/frontend/wizard/steps/RepositoriesStep.tsx — Step 3: repository
// selection sourced exclusively from git-host discovery (spec #133, #130,
// ticket #144).
//
// Provider-agnostic by construction: the step knows a git-host connection and
// a discovery envelope, never a provider id, field name, or URL shape. Every
// async state is rendered through the feedback primitives — the step derives
// with `deriveAsyncState` and hands the result to `AsyncRegion`; it never
// builds loading or error markup by hand.

import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { REPOSITORIES_COPY } from "../../components/feedback/copy-map.js";
import { FeedbackBanner } from "../../components/feedback/FeedbackBanner.js";
import { useRepositoryDiscovery } from "./useRepositoryDiscovery.js";
import "./RepositoriesStep.css";

export function RepositoriesStep() {
  const {
    rows,
    derived,
    selectedRepoIds,
    selectionIsStale,
    rowsSelectable,
    unconfirmedCapabilities,
    refresh,
    toggleRepository,
    restartSelection,
    canAdvance,
    nextStep,
    prevStep,
  } = useRepositoryDiscovery();

  const failedParts = [
    REPOSITORIES_COPY.discoveryUnconfirmed,
    ...unconfirmedCapabilities,
  ];

  return (
    <div
      id="onboard-step-3"
      className="wizard-step-pane repositories-step-pane"
    >
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">{REPOSITORIES_COPY.title}</h2>
        <p className="wizard-step-subtitle">{REPOSITORIES_COPY.subtitle}</p>
      </div>

      <div
        id="repositories-discovery"
        className="repositories-discovery-region"
      >
        <AsyncRegion
          derived={derived}
          onRetry={refresh}
          emptyCopy={REPOSITORIES_COPY.empty}
          failedParts={failedParts}
        >
          {rows.length > 0 && !rowsSelectable && (
            <div
              id="repositories-stale-results"
              className="repositories-stale-results"
            >
              <FeedbackBanner
                tone="warning"
                message={REPOSITORIES_COPY.staleResults}
              />
            </div>
          )}

          <ul className="repositories-list" id="repositories-list">
            {rows.map((row) => (
              <li key={row.id} className="repositories-list-item">
                <label
                  className={
                    rowsSelectable
                      ? "repositories-list-row"
                      : "repositories-list-row repositories-list-row--disabled"
                  }
                >
                  <input
                    id={`repo-select-${row.id}`}
                    className="repositories-list-checkbox"
                    type="checkbox"
                    // Rows produced for a connection that is no longer current
                    // are shown as placeholder content and nothing more: not
                    // selectable, so an old configuration's repository can
                    // never be recorded under the current one (#133
                    // correction 4).
                    disabled={!rowsSelectable}
                    checked={selectedRepoIds.includes(row.id)}
                    onChange={() => toggleRepository(row)}
                  />
                  <span className="repositories-list-name">{row.name}</span>
                  <span className="repositories-list-remote">{row.remote}</span>
                  <span className="repositories-role-tag">
                    {row.isApplication
                      ? REPOSITORIES_COPY.applicationRoleLabel
                      : REPOSITORIES_COPY.noApplicationRoleLabel}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {selectionIsStale && (
            <div
              className="repositories-stale-selection"
              id="repositories-stale-selection"
            >
              <FeedbackBanner
                tone="warning"
                message={REPOSITORIES_COPY.staleSelection}
              />
              <div className="repositories-stale-actions">
                <button
                  type="button"
                  id="btn-repositories-restart-selection"
                  className="btn-secondary btn-sm"
                  onClick={restartSelection}
                >
                  {REPOSITORIES_COPY.staleSelectionAction}
                </button>
              </div>
            </div>
          )}

          {selectedRepoIds.length > 0 && (
            <p className="repositories-selection-summary">
              {REPOSITORIES_COPY.selectionSummary(selectedRepoIds.length)}
            </p>
          )}
        </AsyncRegion>
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          id="btn-step-3-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← {REPOSITORIES_COPY.previous}
        </button>
        <button
          type="button"
          id="btn-step-3-next"
          className="btn-primary"
          onClick={nextStep}
          disabled={!canAdvance}
        >
          {REPOSITORIES_COPY.next} →
        </button>
      </div>
    </div>
  );
}
