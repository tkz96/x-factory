// src/frontend/views/HistoryView.tsx — Historical completed and active runs view (XFM-38, XFM-40, XFM-49).

import { useMemo, useState } from "react";
import { RunHistoryCard } from "../components/history/RunHistoryCard.js";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";

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
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            margin: "1rem 0 1.2rem",
            flexWrap: "wrap",
          }}
        >
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
              style={
                filter === item.id
                  ? {
                      background: "var(--accent)",
                      color: "#fff",
                      borderColor: "var(--accent)",
                    }
                  : undefined
              }
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id="history-runs-container">
          {isLoading ? (
            <div className="empty-state card">
              <div className="spinner-sm" />
              <p style={{ marginTop: "1rem" }}>Loading run history…</p>
            </div>
          ) : error ? (
            <div className="empty-state card">
              <div className="empty-icon">
                <svg className="icon icon-xl" aria-hidden="true">
                  <use href="/assets/icons/sprite.svg#icon-alert-circle" />
                </svg>
              </div>
              <h3>Unable to Load History</h3>
              <p className="error-message">{String(error)}</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-icon">
                <svg className="icon icon-xl" aria-hidden="true">
                  <use href="/assets/icons/sprite.svg#icon-clock" />
                </svg>
              </div>
              <p>
                No factory runs found. Launch your first run to populate
                history.
              </p>
              <button
                type="button"
                className="btn-primary btn-sm"
                style={{ marginTop: "1rem" }}
                onClick={() => openNewRunModal()}
              >
                Launch New Run
              </button>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="empty-state card">
              <p className="text-muted">
                No runs matching the &ldquo;{filter}&rdquo; filter.
              </p>
            </div>
          ) : (
            filteredRuns.map((run) => <RunHistoryCard key={run.id} run={run} />)
          )}
        </div>
      </div>
    </section>
  );
}
