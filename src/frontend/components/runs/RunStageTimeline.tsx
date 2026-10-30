// src/frontend/components/runs/RunStageTimeline.tsx — The left panel's stage timeline (spec "Left panel:
// stage timeline"). Six stages in order, each a rail node with a dotted connector and a collapsible body
// that holds the stage's chat rows. Controlled: the parent owns which stages are open.

import "./RunChat.css";
import "./RunStageTimeline.css";

import { type ReactNode, useId, useState } from "react";
import type { WorkflowStage } from "../../../shared/types.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import { groupRows } from "../../lib/run-chat-rows.js";
import {
  formatTook,
  type StageGroup,
  type StageState,
} from "../../lib/run-stages.js";
import { STATUS_COPY } from "../feedback/copy-map.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Icon } from "../ui/Icon.js";
import { Spinner } from "../ui/Spinner.js";
import { RunChatRow } from "./RunChatItem.js";
import { RunDisclosure } from "./RunDisclosure.js";

export interface RunStageTimelineProps {
  groups: StageGroup[];
  /** The stages whose bodies are open. */
  open: ReadonlySet<WorkflowStage>;
  onToggle: (stage: WorkflowStage) => void;
  /** The clock the chat rows' relative times read from. */
  now: number;
  /** The retry offered for a trailing error row, if any. */
  retryFor?: (item: ChatItem) => (() => void) | undefined;
  /** Rendered after the header of the decision stage (see `defaultDecisionStage`), outside the collapsible body. */
  decision?: ReactNode;
  /** The stage the decision renders in; defaults to `defaultDecisionStage(groups)`. */
  decisionStage?: WorkflowStage | undefined;
  /** True once the stream has opened or any event has arrived (#313). Defaults to true. */
  eventsLoaded?: boolean | undefined;
  /** The note shown when the current stage is empty and events are loaded (#313). */
  emptyNote?: string | undefined;
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

const STATE_STATUS: Partial<
  Record<StageState, { text: string; tone: BadgeTone }>
> = {
  failed: { text: STATUS_COPY.stageFailed, tone: "error" },
  stopped: { text: STATUS_COPY.stageStopped, tone: "neutral" },
};

/** A folded run of agent updates: one disclosure row, closed until the reader opens it. */
function ActivityGroup({ items, now }: { items: ChatItem[]; now: number }) {
  const [isOpen, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="run-chat-group">
      <RunDisclosure
        id={`${id}-head`}
        controls={`${id}-body`}
        isOpen={isOpen}
        onToggle={() => setOpen((open) => !open)}
        className="run-chat-group-header"
      >
        <span className="text-subhead">{`${items.length} agent updates`}</span>
      </RunDisclosure>
      <div id={`${id}-body`} className="run-chat-group-body" hidden={!isOpen}>
        {items.map((item) => (
          <RunChatRow key={item.id} item={item} now={now} />
        ))}
      </div>
    </div>
  );
}

function StageRows({
  items,
  now,
  retryFor,
}: {
  items: ChatItem[];
  now: number;
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
            onRetry={retryFor?.(row.item)}
          />
        ) : (
          <ActivityGroup key={row.id} items={row.items} now={now} />
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
  retryFor,
  decision,
  decisionStage,
  eventsLoaded = true,
  emptyNote,
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
        const showSpinner = !eventsLoaded && isCurrent;
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
            <RunDisclosure
              id={headId}
              controls={bodyId}
              isOpen={isOpen}
              onToggle={() => onToggle(group.stage)}
              className="run-stage-header"
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
                <Badge tone={statusText.tone}>{statusText.text}</Badge>
              )}
            </RunDisclosure>
            {holdsDecision && (
              <div className="run-stage-decision">{decision}</div>
            )}
            <section
              id={bodyId}
              aria-labelledby={headId}
              className="run-stage-body"
              data-open={isOpen ? "true" : "false"}
              inert={!isOpen}
            >
              <div className="run-stage-panel">
                {showSpinner ? (
                  <div className="run-stage-note">
                    <Spinner label="Loading events…" />
                  </div>
                ) : (
                  <>
                    {group.items.length === 0 && (
                      <div className="run-stage-note">
                        <EmptyState
                          message={
                            isCurrent && emptyNote ? emptyNote : "Nothing yet."
                          }
                        />
                      </div>
                    )}
                    <StageRows
                      items={group.items}
                      now={now}
                      retryFor={retryFor}
                    />
                  </>
                )}
              </div>
            </section>
          </li>
        );
      })}
    </ol>
  );
}
