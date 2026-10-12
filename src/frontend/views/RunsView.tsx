import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { Badge } from "../components/ui/Badge.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useNow } from "../hooks/useNow.js";
import { useRuns } from "../hooks/useQueries.js";
import {
  formatRelativeTime,
  formatTimestamp,
} from "../lib/format-timestamp.js";
import { runsInScope } from "../lib/project-scope.js";
import { runStatusText, runStatusTone } from "../lib/run-status-ui.js";
import {
  countRunsByFilter,
  defaultRunsFilter,
  filterRunsList,
  parseRunsFilter,
  RUNS_FILTERS,
  type RunsFilterId,
} from "../lib/runs-list.js";
import { MotionList, MotionListItem } from "../motion/MotionList.js";
import "./RunsView.css";
import type { Run, StageModelUse } from "../../shared/types.js";
import { latestModelFor } from "../lib/run-models.js";

/** " · gemini-x" for the Builder model the run last used (#279). */
function builderModelLabel(stageModels?: readonly StageModelUse[]): string {
  const builder = latestModelFor(stageModels ?? [], "builder");
  return builder ? ` · ${builder.modelId}` : "";
}

/** The filter the user chose last, kept per viewer (#259). */
const LAST_FILTER_KEY = "runs-list-filter";

/** When the row's state last changed: the PR's merge or close time, else the run's update (#271). */
function runShownAt(r: Run): string {
  const outcome = r.pullRequestOutcome;
  if (outcome?.status === "merged" && outcome.mergedAt) return outcome.mergedAt;
  if (outcome?.status === "closed" && outcome.closedAt) return outcome.closedAt;
  return r.updatedAt;
}

function readLastChosenFilter(): RunsFilterId | null {
  try {
    return (
      parseRunsFilter(window.localStorage.getItem(LAST_FILTER_KEY)) ?? null
    );
  } catch {
    // Storage can be blocked: the default filter applies instead.
    return null;
  }
}

function rememberFilter(id: RunsFilterId): void {
  try {
    window.localStorage.setItem(LAST_FILTER_KEY, id);
  } catch {
    // Storage can be blocked: the choice simply is not remembered.
  }
}

const EMPTY_COPY: Record<RunsFilterId, string> = {
  "needs-you": "Nothing needs you right now.",
  running: "No runs are working right now. Start one from Tickets.",
  done: "No finished runs yet.",
  all: "No runs yet. Start one from Tickets.",
};

/**
 * The Runs section (#258, #259). One list with a Needs you / Running / Done /
 * All filter. The URL's `?filter=` wins; without one, Needs you is chosen while
 * a run waits for the user and otherwise the last choice is kept. Counts and
 * rows come from the runs cache, which the app-wide stream patches live.
 */
export function RunsView() {
  const runsQuery = useRuns();
  // The shared project scope narrows the list and its counts (#260).
  const { scope } = useCurrentProject();
  const allRuns = runsQuery.data ?? [];
  const runs = runsInScope(allRuns, scope);
  const now = useNow();
  const { refetch } = runsQuery;
  const [params, setParams] = useSearchParams();
  const [lastChosen] = useState(readLastChosenFilter);

  const counts = countRunsByFilter(runs);
  const filter: RunsFilterId =
    parseRunsFilter(params.get("filter")) ??
    defaultRunsFilter({
      // The same unscoped count the Runs badge shows, so a run waiting in another
      // project still makes Needs you the default (#259).
      needsYouCount: countRunsByFilter(allRuns)["needs-you"],
      lastChosen,
    });

  const shown = filterRunsList(runs, filter);
  const derived = deriveAsyncState(runsQuery, {
    isEmpty: (query) => Array.isArray(query.data) && shown.length === 0,
  });

  const choose = (id: string) => {
    const next = parseRunsFilter(id) ?? "running";
    rememberFilter(next);
    setParams({ filter: next }, { replace: true });
  };

  return (
    <section id="area-runs" className="area-view active">
      <div className="runs-header">
        <SegmentedControl
          label="Show"
          value={filter}
          onChange={choose}
          options={RUNS_FILTERS.map((f) => ({
            id: f.id,
            label: f.label,
            count: counts[f.id],
          }))}
        />
      </div>
      <AsyncRegion
        derived={derived}
        onRetry={() => refetch()}
        placeholderRows={5}
        emptyCopy={EMPTY_COPY[filter]}
        emptyAction={
          filter === "running" || filter === "all" ? (
            <Link
              to="/tickets"
              className="ui-button ui-button--secondary ui-button--sm"
            >
              <svg className="icon icon-sm" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-layers" />
              </svg>
              <span>Go to Tickets</span>
            </Link>
          ) : undefined
        }
      >
        <div data-list>
          <MotionList className="runs-grid">
            <AnimatePresence initial={false}>
              {shown.map((r) => (
                <MotionListItem key={r.id}>
                  <Link
                    to={`/runs/${r.id}`}
                    className="card run-card run-card-link"
                    data-list-row
                  >
                    <div className="run-card-header">
                      <div>
                        <span className="code-sub run-card-key">
                          {r.ticket?.id || r.id}
                        </span>
                        <h3 className="run-card-title">
                          {r.ticket?.title || "Task"}
                        </h3>
                        <span className="code-sub run-card-subtitle">
                          {r.project?.name || r.project?.id || ""}
                          {builderModelLabel(r.stageModels)}
                        </span>
                      </div>
                      <div className="run-card-status">
                        <Badge
                          tone={
                            r.pullRequestOutcome
                              ? r.pullRequestOutcome.status === "merged"
                                ? "success"
                                : "neutral"
                              : runStatusTone(r.status)
                          }
                        >
                          {r.pullRequestOutcome
                            ? r.pullRequestOutcome.status === "merged"
                              ? "Merged"
                              : "Closed without merging"
                            : runStatusText(r.status)}
                        </Badge>
                        <time
                          className="run-card-time code-sub"
                          dateTime={runShownAt(r)}
                          title={formatTimestamp(runShownAt(r))}
                        >
                          {formatRelativeTime(runShownAt(r), now)}
                        </time>
                      </div>
                    </div>
                  </Link>
                </MotionListItem>
              ))}
            </AnimatePresence>
          </MotionList>
        </div>
      </AsyncRegion>
    </section>
  );
}
