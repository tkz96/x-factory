import { Link } from "react-router-dom";
import {
  ACTIVE_RUN_STATUSES,
  runStatusLabel,
} from "../../shared/run-status-policy.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { useModal } from "../context/ModalContext.js";
import { useRuns } from "../hooks/useQueries.js";
import "./RunsView.css";

export function RunsView() {
  const { openNewRunModal } = useModal();
  const runsQuery = useRuns();
  const runs = runsQuery.data ?? [];
  const { refetch } = runsQuery;

  const activeRuns = runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  const derived = deriveAsyncState(runsQuery, {
    isEmpty: (query) => Array.isArray(query.data) && activeRuns.length === 0,
  });

  return (
    <section id="area-runs" className="area-view active">
      <AsyncRegion
        derived={derived}
        onRetry={() => refetch()}
        emptyCopy="No active runs. Start a run from the Work Queue or launch one now."
        emptyAction={
          <button
            type="button"
            id="btn-runs-start"
            className="btn-primary btn-sm"
            onClick={() => openNewRunModal()}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-plus" />
            </svg>
            <span>Launch New Run</span>
          </button>
        }
      >
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
                    {runStatusLabel(r.status)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </AsyncRegion>
    </section>
  );
}
