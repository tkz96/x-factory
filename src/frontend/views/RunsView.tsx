import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { Badge } from "../components/ui/Badge.js";
import { ListGroup } from "../components/ui/ListGroup.js";
import { ListRow } from "../components/ui/ListRow.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useNow } from "../hooks/useNow.js";
import { useRuns } from "../hooks/useQueries.js";
import {
  formatRelativeTime,
  formatTimestamp,
} from "../lib/format-timestamp.js";
import { runsInScope } from "../lib/project-scope.js";
import type { RunStatusTone } from "../lib/run-status-ui.js";
import { runStatusText, runStatusTone } from "../lib/run-status-ui.js";
import {
  countRunsByFilter,
  defaultRunsFilter,
  filterRunsList,
  parseRunsFilter,
  RUNS_FILTERS,
  type RunsFilterId,
} from "../lib/runs-list.js";
import { MotionListItem } from "../motion/MotionList.js";
import "./RunsView.css";
import type { Run, StageModelUse } from "../../shared/types.js";
import { latestModelFor } from "../lib/run-models.js";

/** The Builder model the run last used (#279), or "" when none was recorded. */
function builderModelLabel(stageModels?: readonly StageModelUse[]): string {
  const builder = latestModelFor(stageModels ?? [], "builder");
  return builder ? builder.modelId : "";
}

/** The row's subtitle: which ticket, which project, which model — all in plain text. */
function runRowSubtitle(r: Run): string {
  const project = r.project?.name || r.project?.id || "";
  return [r.ticket?.id || r.id, project, builderModelLabel(r.stageModels)]
    .filter((part) => part !== "")
    .join(" · ");
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
  "needs-you": "Runs that need a decision from you appear here.",
  running: "Start one from Tickets, and it appears here while it works.",
  done: "Finished runs appear here.",
  all: "Start one from Tickets, and it appears here.",
};

/** The empty list's headline per filter: what is missing, in a few words. */
const EMPTY_TITLE: Record<RunsFilterId, string> = {
  "needs-you": "Nothing needs you right now",
  running: "No runs are working",
  done: "No finished runs yet",
  all: "No runs yet",
};

/** The status a row carries: the pull request's outcome when there is one (#271). */
function runRowStatus(r: Run): { text: string; tone: RunStatusTone } {
  const outcome = r.pullRequestOutcome;
  if (outcome) {
    return outcome.status === "merged"
      ? { text: "Merged", tone: "success" }
      : { text: "Closed without merging", tone: "neutral" };
  }
  return { text: runStatusText(r.status), tone: runStatusTone(r.status) };
}

/** One run, as a row of the grouped list: a link into the run page. */
function RunRow({ r, now }: { r: Run; now: number }) {
  const status = runRowStatus(r);
  const shownAt = runShownAt(r);
  return (
    <ListRow
      href={`/runs/${r.id}`}
      className="run-row-link"
      title={r.ticket?.title || "Task"}
      subtitle={runRowSubtitle(r)}
      trailing={
        <>
          <Badge tone={status.tone}>{status.text}</Badge>
          <time
            className="run-row-time"
            dateTime={shownAt}
            title={formatTimestamp(shownAt)}
          >
            {formatRelativeTime(shownAt, now)}
          </time>
        </>
      }
    />
  );
}

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
        placeholderGroup
        emptyTitle={EMPTY_TITLE[filter]}
        emptyCopy={EMPTY_COPY[filter]}
        emptyIcon="icon-play"
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
        {/* One inset group: the rows share hairlines, and each row is the
            shared list row — no card of its own, no hover lift. */}
        <ListGroup as="div">
          <AnimatePresence initial={false}>
            {shown.map((r) => (
              <MotionListItem key={r.id}>
                <RunRow r={r} now={now} />
              </MotionListItem>
            ))}
          </AnimatePresence>
        </ListGroup>
      </AsyncRegion>
    </section>
  );
}
