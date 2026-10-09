// src/frontend/views/HistoryView.tsx — Historical completed and active runs view (XFM-38, XFM-40, XFM-49).

import { useMemo, useState } from "react";
import {
  ACTIVE_RUN_STATUSES,
  UNSUCCESSFUL_TERMINAL_RUN_STATUSES,
} from "../../shared/run-status-policy.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { RunHistoryCard } from "../components/history/RunHistoryCard.js";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";
import "./HistoryView.css";

type StatusFilter = "all" | "completed" | "active" | "failed";

export function HistoryView() {
  const runsQuery = useRuns();
  const runs = runsQuery.data ?? [];
  const { openNewRunModal } = useModal();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filteredRuns = useMemo(() => {
    switch (filter) {
      case "completed":
        return runs.filter((r) => r.status === "pr_created");
      case "failed":
        return runs.filter((r) =>
          UNSUCCESSFUL_TERMINAL_RUN_STATUSES.has(r.status),
        );
      case "active":
        return runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
      default:
        return runs;
    }
  }, [runs, filter]);

  // One read region over the runs query. "Empty" covers both empty cases:
  // no runs at all (with a launch CTA) and a filter that matches nothing.
  const derived = deriveAsyncState(runsQuery, {
    isEmpty: () => filteredRuns.length === 0,
  });
  const noRunsAtAll = runs.length === 0;

  return (
    <section id="area-history" className="area-view active">
      <div className="view-panel">
        <div className="section-header-flex">
          <div>
            <h2>Factory Run History</h2>
            <p className="text-muted">
              All previous, active, and completed factory runs.
            </p>
          </div>
          <button
            type="button"
            id="btn-history-new-run"
            className="btn-primary"
            onClick={() => openNewRunModal()}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-plus" />
            </svg>
            <span>New Run</span>
          </button>
        </div>

        {/* Filter controls */}
        <div className="history-filter-bar">
          {(
            [
              { id: "all", label: "All Runs" },
              { id: "completed", label: "Delivered (PR)" },
              { id: "active", label: "In Progress" },
              { id: "failed", label: "Failed / Stopped" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn-secondary btn-sm ${filter === item.id ? "active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id="history-runs-container">
          <AsyncRegion
            derived={derived}
            onRetry={() => void runsQuery.refetch()}
            emptyCopy={
              noRunsAtAll
                ? "No factory runs found. Launch your first run to populate history."
                : `No runs matching the “${filter}” filter.`
            }
            emptyAction={
              noRunsAtAll ? (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => openNewRunModal()}
                >
                  <svg className="icon icon-sm" aria-hidden="true">
                    <use href="/assets/icons/sprite.svg#icon-plus" />
                  </svg>
                  <span>Launch New Run</span>
                </button>
              ) : undefined
            }
          >
            {filteredRuns.map((run) => (
              <RunHistoryCard key={run.id} run={run} />
            ))}
          </AsyncRegion>
        </div>
      </div>
    </section>
  );
}
