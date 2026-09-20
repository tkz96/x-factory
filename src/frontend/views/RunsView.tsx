import { Link } from "react-router-dom";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";

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
          <h3 style={{ marginTop: "1rem" }}>Loading Active Runs…</h3>
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
            className="btn-primary btn-sm"
            style={{ marginTop: "1rem" }}
            onClick={() => openNewRunModal()}
          >
            Launch New Run
          </button>
        </div>
      ) : (
        <div>
          <div
            className="section-header-flex"
            style={{ marginBottom: "1.2rem" }}
          >
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

          <div className="runs-grid" style={{ display: "grid", gap: "1rem" }}>
            {activeRuns.map((r) => (
              <Link
                key={r.id}
                to={`/runs/${r.id}`}
                className="card run-card"
                style={{
                  display: "block",
                  textDecoration: "none",
                  color: "inherit",
                  cursor: "pointer",
                }}
                aria-label={`Open run ${r.id}`}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 0.3rem" }}>
                      #{r.ticket?.id || r.id} — {r.ticket?.title || "Task"}
                    </h3>
                    <span className="code-sub" style={{ fontSize: "0.85rem" }}>
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
