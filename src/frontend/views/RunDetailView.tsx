// src/frontend/views/RunDetailView.tsx — The run page (#262, spec #241): the run chat on the left (its
// stages, decision card and message box) and the "Run details" pane on the right. At phone width the
// details pane opens as a sheet from a toolbar button. Every action goes through the server's guards;
// the decision card only offers what the status map allows.

import "./RunDetailView.css";

import { type CSSProperties, useMemo, useRef } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import { RunChat } from "../components/runs/RunChat.js";
import type { CheckpointAction } from "../components/runs/RunCheckpointBar.js";
import {
  RunInspector,
  RunInspectorSheet,
} from "../components/runs/RunInspector.js";
import { RunSplitHandle } from "../components/runs/RunSplitHandle.js";
import {
  type LoadedRun,
  useRunCheckpointActions,
} from "../components/runs/useRunCheckpointActions.js";
import { useRunSplit } from "../components/runs/useRunSplit.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { useMediaQuery } from "../components/ui/useMediaQuery.js";
import { usePageHeader } from "../context/PageHeaderContext.js";
import { useRunDetail } from "../hooks/useRunDetail.js";

/** What a screen that opens this run may pass along in its navigation state. */
interface RunPageState {
  /** A plain note for the reader, shown inline above the run. */
  notice?: string;
}

type RunData = ReturnType<typeof useRunDetail>;

/** The region while the run loads: the one loading state, with no data yet. */
const LOADING = deriveAsyncState({
  data: undefined,
  isPending: true,
  isError: false,
  error: undefined,
});

/** The page heading before the run loads: the same words the shell uses. */
const PAGE_HEADER = {
  title: "Run",
  subtitle: "What the run is doing and what it needs from you",
};

/** A loaded run is named by its ticket, the way the shell names it. */
function runPageHeader(
  run: ReturnType<typeof useRunDetail>["run"],
): typeof PAGE_HEADER {
  if (!run) return PAGE_HEADER;
  return {
    title: `${run.ticket?.id || run.id} — ${run.ticket?.title || "Task"}`,
    subtitle: `${run.project?.name} · ${run.branch}`,
  };
}

function RunLoadingState() {
  return (
    <section id="area-runs" className="area-view active">
      <AsyncRegion derived={LOADING} />
    </section>
  );
}

function RunNotFoundState({ runId }: { runId: string | undefined }) {
  return (
    <section id="area-runs" className="area-view active">
      <EmptyState
        icon="icon-alert-circle"
        title="Run Not Found"
        message={`No active or historical run matches ID: ${runId}`}
        action={
          <Link
            to="/runs"
            className="ui-button ui-button--secondary ui-button--sm"
          >
            ← Back to Runs
          </Link>
        }
      />
    </section>
  );
}

/**
 * The run's page once it has loaded: its actions and the layout around the chat and the details pane.
 * The actions are one hook, so the page's state (the action error, the conflict) belongs to this run.
 */
function RunDetailPage({
  runId,
  run,
  events,
  connected,
  notice,
}: {
  runId: string | undefined;
  run: LoadedRun;
  events: RunData["events"];
  connected: boolean;
  notice: string | undefined;
}) {
  const { actionError, conflict, pending, onAction } = useRunCheckpointActions(
    runId,
    run,
  );

  return (
    <RunDetailLayout
      run={run}
      events={events}
      connected={connected}
      notice={notice}
      actionError={actionError}
      conflict={conflict}
      pending={pending}
      onAction={onAction}
    />
  );
}

/** The chat beside the details pane, or the details as a sheet at phone width. */
function RunDetailLayout({
  run,
  events,
  connected,
  notice,
  actionError,
  conflict,
  pending,
  onAction,
}: {
  run: LoadedRun;
  events: RunData["events"];
  connected: boolean;
  notice: string | undefined;
  actionError: string | null;
  conflict: boolean;
  pending: CheckpointAction | null;
  onAction: (action: CheckpointAction, notes?: string) => void;
}) {
  const isPhone = useMediaQuery("(max-width: 768px)");
  const layoutRef = useRef<HTMLDivElement>(null);
  const { split, setSplit, resetSplit } = useRunSplit();
  const inspectorProps = { run, events, connected };

  return (
    <section id="area-runs" className="area-view active run-detail-container">
      <div
        ref={layoutRef}
        className={
          isPhone
            ? "run-detail-layout run-detail-layout--phone"
            : "run-detail-layout run-detail-layout--split"
        }
        style={
          isPhone
            ? undefined
            : ({ "--run-split": `${split}%` } as CSSProperties)
        }
      >
        <div className="run-detail-main">
          {notice && <FeedbackBanner tone="info" message={notice} />}
          {actionError && (
            <div id="run-error">
              <FeedbackBanner tone="error" message={actionError} />
            </div>
          )}

          {/* Keyed by the run: the chat's own state (the reader's lines, the composer draft, the
              open stages) belongs to one run and never leaks into the next. */}
          <RunChat
            key={run.id}
            run={run}
            events={events}
            onAction={onAction}
            pending={pending}
            conflict={conflict}
            detailsTrigger={
              isPhone ? <RunInspectorSheet {...inspectorProps} /> : undefined
            }
          />
        </div>

        {!isPhone && (
          <RunSplitHandle
            containerRef={layoutRef}
            split={split}
            onSplit={setSplit}
            onReset={resetSplit}
          />
        )}
        {/* Keyed by the run: the pane's own state (the raw-log sheet, the open diff) belongs to
            one run and never leaks into the next. */}
        {!isPhone && <RunInspector key={run.id} {...inspectorProps} />}
      </div>
    </section>
  );
}

export function RunDetailView() {
  // The run page's heading is the shell's toolbar title: the view claims it, and draws none of its own.
  const { runId } = useParams<{ runId: string }>();
  const { run, isLoading, error, events, connected } = useRunDetail(runId);
  const header = useMemo(() => runPageHeader(run), [run]);
  usePageHeader(header);
  const location = useLocation();
  const notice = (location.state as RunPageState | null)?.notice;

  if (isLoading) return <RunLoadingState />;
  if (error || !run) return <RunNotFoundState runId={runId} />;

  return (
    <RunDetailPage
      runId={runId}
      run={run}
      events={events}
      connected={connected}
      notice={notice}
    />
  );
}
