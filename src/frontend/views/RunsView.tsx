import { Link, useSearchParams } from "react-router-dom";
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../../shared/run-status-policy.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { useRuns } from "../hooks/useQueries.js";
import { runStatusText } from "../lib/run-status-ui.js";
import "./RunsView.css";
import type { StageModelUse } from "../../shared/types.js";
import { latestModelFor } from "../lib/run-models.js";

/** " · gemini-x" for the Builder model the run last used (#279). */
function builderModelLabel(stageModels?: readonly StageModelUse[]): string {
  const builder = latestModelFor(stageModels ?? [], "builder");
  return builder ? ` · ${builder.modelId}` : "";
}

type RunsFilter = "running" | "done";

/**
 * The Runs section (#258). `?filter=done` lists finished runs, which is where
 * History's contents now live; anything else lists the runs still working.
 */
export function RunsView() {
  const runsQuery = useRuns();
  const runs = runsQuery.data ?? [];
  const { refetch } = runsQuery;
  const [params, setParams] = useSearchParams();
  const filter: RunsFilter =
    params.get("filter") === "done" ? "done" : "running";

  const shown = runs.filter((r) =>
    filter === "done"
      ? TERMINAL_RUN_STATUSES.has(r.status)
      : ACTIVE_RUN_STATUSES.has(r.status),
  );
  const derived = deriveAsyncState(runsQuery, {
    isEmpty: (query) => Array.isArray(query.data) && shown.length === 0,
  });

  return (
    <section id="area-runs" className="area-view active">
      <div className="runs-header">
        <SegmentedControl
          label="Show"
          value={filter}
          onChange={(id) =>
            setParams(id === "done" ? { filter: "done" } : {}, {
              replace: true,
            })
          }
          options={[
            { id: "running", label: "Running" },
            { id: "done", label: "Done" },
          ]}
        />
      </div>
      <AsyncRegion
        derived={derived}
        onRetry={() => refetch()}
        placeholderRows={5}
        emptyCopy={
          filter === "done"
            ? "No finished runs yet."
            : "No runs are working right now. Start one from Tickets."
        }
        emptyAction={
          filter === "running" ? (
            <Link to="/tickets" className="btn-secondary btn-sm">
              <svg className="icon icon-sm" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-layers" />
              </svg>
              <span>Go to Tickets</span>
            </Link>
          ) : undefined
        }
      >
        <div className="runs-grid" data-list>
          {shown.map((r) => (
            <Link
              key={r.id}
              to={`/runs/${r.id}`}
              className="card run-card run-card-link"
              data-list-row
              aria-label={`Open run ${r.id}`}
            >
              <div className="run-card-header">
                <div>
                  <h3 className="run-card-title">
                    #{r.ticket?.id || r.id} — {r.ticket?.title || "Task"}
                  </h3>
                  <span className="code-sub run-card-subtitle">
                    {r.project?.name || r.project?.id || ""} · {r.branch}
                    {builderModelLabel(r.stageModels)}
                  </span>
                </div>
                <span className="badge" data-status={r.status}>
                  {runStatusText(r.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </AsyncRegion>
    </section>
  );
}
