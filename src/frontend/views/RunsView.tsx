import { Link } from "react-router-dom";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";
import "./RunsView.css";

export function RunsView() {
  const { openNewRunModal } = useModal();
  const { data: runs = [], isLoading } = useRuns();

  const activeRuns = runs.filter(
    (r) =>
      r.status !== "pr_created" &&
      r.status !== "failed" &&
      r.status !== "stopped",
  );

  return (
    <section id="area-runs" className="area-view active">
      {isLoading ? (
        <div className="empty-state card">
          <div className="spinner-sm" />
          <h3 className="mt-4">Loading Active Runs…</h3>
        </div>
      ) : activeRuns.length === 0 ? (
        /* Standby state when no active run */
        <div id="runs-standby" className="empty-state card">
          <div className="empty-icon">
            <svg className="icon icon-xl" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-play" />
            </svg>
          </div>
          <h3>No Active Factory Run</h3>
          <p>Start a run from the Work Queue or click Launch New Run.</p>
          <button
            type="button"
            id="btn-runs-start"
            className="btn-primary btn-sm mt-4"
            onClick={() => openNewRunModal()}
          >
            Launch New Run
          </button>
        </div>
      ) : (
        <div>
          <div className="runs-header">
            <div>
              <h2>Active Runs</h2>
              <p className="text-muted">
                Currently executing agentic workflow pipelines.
              </p>
            </div>
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
          </div>

          <div className="runs-grid">
            {activeRuns.map((r) => (
              <Link
                key={r.id}
                to={`/runs/${r.id}`}
                className="card run-card run-card-link"
                aria-label={`Open run ${r.id}`}
              >
                <div className="run-card-header">
                  <div>
                    <h3 className="run-card-title">
                      #{r.ticket?.id || r.id} — {r.ticket?.title || "Task"}
                    </h3>
                    <span className="code-sub run-card-subtitle">
                      {r.project?.name || r.project?.id || ""} · {r.branch}
                    </span>
                  </div>
                  <span className="badge" data-status={r.status}>
                    {r.status.replace(/_/g, " ")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
