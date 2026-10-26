// src/frontend/components/runs/RunStageTimeline.tsx — The left panel's stage timeline (spec "Left panel:
// stage timeline"). Six stages in order, each a rail node with a dotted connector and a collapsible body
// that holds the stage's chat rows. Controlled: the parent owns which stages are open.

import "./RunChat.css";
import "./RunStageTimeline.css";

import { type ReactNode, useId } from "react";
import type { DiffFileSummary } from "../../../shared/diff-summary.js";
import type { WorkflowStage } from "../../../shared/types.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import { groupRows } from "../../lib/run-chat-rows.js";
import {
  formatTook,
  type StageGroup,
  type StageState,
} from "../../lib/run-stages.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Icon } from "../ui/Icon.js";
import { RunChatRow } from "./RunChatItem.js";

export interface RunStageTimelineProps {
  groups: StageGroup[];
  /** The stages whose bodies are open. */
  open: ReadonlySet<WorkflowStage>;
  onToggle: (stage: WorkflowStage) => void;
  /** The clock the chat rows' relative times read from. */
  now: number;
  onOpenFile: (file: DiffFileSummary) => void;
  /** The retry offered for a trailing error row, if any. */
  retryFor?: (item: ChatItem) => (() => void) | undefined;
  /** Rendered at the end of the body of the decision stage (see `defaultDecisionStage`). */
  decision?: ReactNode;
  /** The stage the decision renders in; defaults to `defaultDecisionStage(groups)`. */
  decisionStage?: WorkflowStage | undefined;
  /** The run waits on the user: the current stage shows a "Waiting for you" pill. */
  waiting: boolean;
}

/**
 * The stage a reader is looking at: the current stage, else the failed or stopped one, else the
 * last stage that has any items. Null when no stage qualifies.
 */
export function focusStage(
  groups: readonly StageGroup[],
): WorkflowStage | null {
  const focus =
    groups.find((group) => group.state === "current") ??
    groups.find((group) => group.state === "failed") ??
    groups.find((group) => group.state === "stopped");
  if (focus) return focus.stage;
  const lastWithItems = [...groups]
    .reverse()
    .find((group) => group.items.length > 0);
  return lastWithItems?.stage ?? null;
}

/**
 * The stages a reader sees open at first: the focus stage (see `focusStage`).
 */
export function defaultOpenStages(
  groups: readonly StageGroup[],
): Set<WorkflowStage> {
  const stage = focusStage(groups);
  return new Set(stage ? [stage] : []);
}

/**
 * The stage the decision card renders in: the focus stage, so a run that has left the stages
 * (failed, stopped, pull request opened) still shows it in the stage it ended in. Falls back to
 * the last stage when no stage has items.
 */
export function defaultDecisionStage(
  groups: readonly StageGroup[],
): WorkflowStage | null {
  return focusStage(groups) ?? groups.at(-1)?.stage ?? null;
}

const STATE_STATUS: Partial<Record<StageState, string>> = {
  failed: "Failed",
  stopped: "Stopped",
};

function StageRows({
  items,
  now,
  onOpenFile,
  retryFor,
}: {
  items: ChatItem[];
  now: number;
  onOpenFile: (file: DiffFileSummary) => void;
  retryFor?: ((item: ChatItem) => (() => void) | undefined) | undefined;
}) {
  return (
    <>
      {groupRows(items).map((row) =>
        row.kind === "item" ? (
          <RunChatRow
            key={row.item.id}
            item={row.item}
            now={now}
            onOpenFile={onOpenFile}
            onRetry={retryFor?.(row.item)}
          />
        ) : (
          <details key={row.id} className="run-chat-group">
            <summary>{`${row.items.length} progress updates`}</summary>
            {row.items.map((item) => (
              <RunChatRow
                key={item.id}
                item={item}
                now={now}
                onOpenFile={onOpenFile}
              />
            ))}
          </details>
        ),
      )}
    </>
  );
}

export function RunStageTimeline({
  groups,
  open,
  onToggle,
  now,
  onOpenFile,
  retryFor,
  decision,
  decisionStage,
  waiting,
}: RunStageTimelineProps) {
  const idBase = useId();
  const decisionAt = decisionStage ?? defaultDecisionStage(groups);

  return (
    <ol className="run-stage-list" aria-label="Run stages">
      {groups.map((group) => {
        const isOpen = open.has(group.stage);
        const isCurrent = group.state === "current";
        const headId = `${idBase}-${group.stage}-head`;
        const bodyId = `${idBase}-${group.stage}-body`;
        const statusText = STATE_STATUS[group.state];
        const holdsDecision = Boolean(decision) && group.stage === decisionAt;
        return (
          <li key={group.stage} className="run-stage" data-state={group.state}>
            <span className="run-stage-node" aria-hidden="true">
              {group.state === "done" && (
                <Icon
                  name="icon-stage-done"
                  size="sm"
                  className="run-stage-check"
                />
              )}
            </span>
            <Button
              variant="quiet"
              id={headId}
              className="run-stage-header"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onPress={() => onToggle(group.stage)}
            >
              <span className="run-stage-label text-headline">
                {group.label}
              </span>
              {group.tookMs !== null && (
                <span className="run-stage-took text-footnote">
                  {`Took ${formatTook(group.tookMs)}`}
                </span>
              )}
              {statusText && (
                <span className="run-stage-status text-footnote">
                  {statusText}
                </span>
              )}
              {isCurrent && waiting && (
                <span className="run-stage-waiting text-caption-1">
                  <span className="run-stage-waiting-dot" aria-hidden="true" />
                  Waiting for you
                </span>
              )}
              <Icon
                name="icon-stage-chevron"
                size="sm"
                className="run-stage-chevron"
              />
            </Button>
            <section
              id={bodyId}
              aria-labelledby={headId}
              className="run-stage-body"
              data-open={isOpen ? "true" : "false"}
              inert={!isOpen}
            >
              <div className="run-stage-panel">
                {group.items.length === 0 && !holdsDecision && (
                  <div className="run-stage-note">
                    <EmptyState message="Nothing yet." />
                  </div>
                )}
                <StageRows
                  items={group.items}
                  now={now}
                  onOpenFile={onOpenFile}
                  retryFor={retryFor}
                />
                {holdsDecision && decision}
              </div>
            </section>
          </li>
        );
      })}
    </ol>
  );
}
