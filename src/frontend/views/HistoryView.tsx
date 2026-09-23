// src/frontend/views/HistoryView.tsx — Historical completed and active runs view (XFM-38, XFM-40, XFM-49).

import { useMemo, useState } from "react";
import { EmptyStateCard } from "../components/EmptyStateCard.js";
import { RunHistoryCard } from "../components/history/RunHistoryCard.js";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";
import "./HistoryView.css";

type StatusFilter = "all" | "completed" | "active" | "failed";

export function HistoryView() {
  const { data: runs = [], isLoading, error } = useRuns();
  const { openNewRunModal } = useModal();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filteredRuns = useMemo(() => {
    switch (filter) {
      case "completed":
        return runs.filter((r) => r.status === "pr_created");
      case "failed":
        return runs.filter(
          (r) => r.status === "failed" || r.status === "stopped",
        );
      case "active":
        return runs.filter(
          (r) =>
            r.status !== "pr_created" &&
            r.status !== "failed" &&
            r.status !== "stopped",
        );
      default:
        return runs;
    }
  }, [runs, filter]);

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
          {isLoading ? (
            <EmptyStateCard type="loading" message="Loading run history…" />
          ) : error ? (
            <EmptyStateCard
              type="error"
              title="Unable to Load History"
              message={String(error)}
            />
          ) : runs.length === 0 ? (
            <EmptyStateCard
              icon="icon-clock"
              message="No factory runs found. Launch your first run to populate history."
              actionText="Launch New Run"
              onAction={() => openNewRunModal()}
            />
          ) : filteredRuns.length === 0 ? (
            <EmptyStateCard
              message={`No runs matching the “${filter}” filter.`}
            />
          ) : (
            filteredRuns.map((run) => <RunHistoryCard key={run.id} run={run} />)
          )}
        </div>
      </div>
    </section>
  );
}
