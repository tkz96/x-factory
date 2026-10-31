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
  type Attempt,
  focusStage,
  formatTook,
  type StageGroup,
  type StageState,
} from "../../lib/run-stages.js";
import { STATUS_COPY } from "../feedback/copy-map.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Icon } from "../ui/Icon.js";
import { Spinner } from "../ui/Spinner.js";
import { RunChatRow } from "./RunChatItem.js";
import { RunDisclosure } from "./RunDisclosure.js";

export interface RunStageTimelineProps {
  /** The stages of the latest attempt: the ones `open` and `onToggle` speak of. */
  groups: StageGroup[];
  /**
   * Every attempt, oldest first. With more than one, each sits under a disclosure: the latest is
   * open and uses `groups`; earlier ones are folded and keep their own open stages.
   */
  attempts?: readonly Attempt[] | undefined;
  /** The stages whose bodies are open. */
  open: ReadonlySet<WorkflowStage>;
  onToggle: (stage: WorkflowStage) => void;
  /** Pins the clock the rows' relative times read from; by default they read the shared minute ticker. */
  now?: number | undefined;
  /** The retry offered for a trailing error row, if any. */
  retryFor?: (item: ChatItem) => (() => void) | undefined;
  /** Rendered after the header of the decision stage (see `defaultDecisionStage`), outside the collapsible body. */
  decision?: ReactNode;
  /** True once the stream has opened or any event has arrived (#313). Defaults to true. */
  eventsLoaded?: boolean | undefined;
  /** The note shown when the current stage is empty and events are loaded (#313). */
  emptyNote?: string | undefined;
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

/**
 * A stage's heading. Under an attempt's h3 it is an h4, so the heading path never skips a level;
 * a run with one attempt has no attempt heading and its stages are h3.
 */
function StageHeading({
  nested,
  children,
}: {
  nested: boolean;
  children: ReactNode;
}) {
  return nested ? (
    <h4 className="run-stage-heading text-headline">{children}</h4>
  ) : (
    <h3 className="run-stage-heading text-headline">{children}</h3>
  );
}

/** A folded run of agent updates: one disclosure row, closed until the reader opens it. */
function ActivityGroup({
  items,
  now,
}: {
  items: ChatItem[];
  now?: number | undefined;
}) {
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
        {/* A folded group renders nothing until it is opened (#321). */}
        {isOpen &&
          items.map((item) => (
            <RunChatRow key={item.id} item={item} now={now} />
          ))}
      </div>
    </div>
  );
}

/** How many of a stage's latest items show at first, and how many each "Show Earlier" adds (#321). */
const STAGE_PAGE = 50;

function StageRows({
  items,
  now,
  retryFor,
}: {
  items: ChatItem[];
  now?: number | undefined;
  retryFor?: ((item: ChatItem) => (() => void) | undefined) | undefined;
}) {
  const [shown, setShown] = useState(STAGE_PAGE);
  const hidden = Math.max(0, items.length - shown);
  const visible = hidden > 0 ? items.slice(hidden) : items;
  return (
    <>
      {hidden > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setShown((count) => count + STAGE_PAGE)}
        >
          Show Earlier
        </Button>
      )}
      {groupRows(visible).map((row) =>
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

interface StageListProps {
  groups: StageGroup[];
  open: ReadonlySet<WorkflowStage>;
  onToggle: (stage: WorkflowStage) => void;
  now?: number | undefined;
  retryFor?: ((item: ChatItem) => (() => void) | undefined) | undefined;
  decision?: ReactNode;
  label?: string;
  /** True under an attempt heading: the stage headings are one level lower. */
  nested?: boolean;
  eventsLoaded?: boolean | undefined;
  emptyNote?: string | undefined;
}

/** An earlier attempt: its stages are read on their own, apart from the live open state. */
function EarlierStages({
  groups,
  ...rest
}: Omit<StageListProps, "open" | "onToggle">) {
  const [open, setOpen] = useState<ReadonlySet<WorkflowStage>>(new Set());
  return (
    <StageList
      groups={groups}
      open={open}
      onToggle={(stage) =>
        setOpen((current) => {
          const next = new Set(current);
          if (!next.delete(stage)) next.add(stage);
          return next;
        })
      }
      {...rest}
    />
  );
}

/** One attempt of a reworked run, under its disclosure header. */
function AttemptSection({
  attempt,
  isLatest,
  children,
}: {
  attempt: Attempt;
  isLatest: boolean;
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(isLatest);
  const id = useId();
  return (
    <section className="run-attempt" data-latest={isLatest ? "true" : "false"}>
      <h3 className="run-attempt-heading text-subhead">
        <RunDisclosure
          id={`${id}-head`}
          controls={`${id}-body`}
          isOpen={isOpen}
          onToggle={() => setOpen((value) => !value)}
          className="run-attempt-header"
        >
          <span>{attempt.label}</span>
        </RunDisclosure>
      </h3>
      <div id={`${id}-body`} className="run-attempt-body" hidden={!isOpen}>
        {/* A folded attempt renders nothing until it is opened (#321). */}
        {isOpen ? children : null}
      </div>
    </section>
  );
}

export function RunStageTimeline({
  attempts,
  groups,
  open,
  onToggle,
  now,
  retryFor,
  decision,
  eventsLoaded = true,
  emptyNote,
}: RunStageTimelineProps) {
  if (!attempts || attempts.length < 2) {
    return (
      <StageList
        groups={groups}
        open={open}
        onToggle={onToggle}
        now={now}
        retryFor={retryFor}
        decision={decision}
        eventsLoaded={eventsLoaded}
        emptyNote={emptyNote}
      />
    );
  }
  return (
    <div className="run-attempts">
      {attempts.map((attempt, index) => {
        const isLatest = index === attempts.length - 1;
        return (
          <AttemptSection
            key={attempt.number}
            attempt={attempt}
            isLatest={isLatest}
          >
            {isLatest ? (
              <StageList
                label={attempt.label}
                nested
                groups={groups}
                open={open}
                onToggle={onToggle}
                now={now}
                retryFor={retryFor}
                decision={decision}
                eventsLoaded={eventsLoaded}
                emptyNote={emptyNote}
              />
            ) : (
              <EarlierStages
                label={attempt.label}
                nested
                groups={attempt.groups}
                now={now}
              />
            )}
          </AttemptSection>
        );
      })}
    </div>
  );
}

function StageList({
  groups,
  open,
  onToggle,
  now,
  retryFor,
  decision,
  label,
  nested = false,
  eventsLoaded = true,
  emptyNote,
}: StageListProps) {
  const idBase = useId();
  const decisionAt = defaultDecisionStage(groups);

  return (
    <ol
      className="run-stage-list"
      aria-label={label ? `Run stages, ${label}` : "Run stages"}
    >
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
            <StageHeading nested={nested}>
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
                {/* The stage that holds the decision card does not say the failure or the stop a
                    second time: the header says it once and the card says it once. */}
                {statusText && !holdsDecision && (
                  <Badge tone={statusText.tone}>{statusText.text}</Badge>
                )}
              </RunDisclosure>
            </StageHeading>
            {/* The decision card sits directly after the stage's header, outside
                the collapsible body (#312 ticket 3). */}
            {holdsDecision && (
              <div className="run-stage-decision">{decision}</div>
            )}
            {/* Plain content under the heading: a labelled <section> would be a
                region, and six landmarks drown the heading path (#319, US20). */}
            <div
              id={bodyId}
              className="run-stage-body"
              data-open={isOpen ? "true" : "false"}
              inert={!isOpen}
            >
              <div className="run-stage-panel">
                {/* A closed stage renders nothing: its rows mount when it opens (#321). */}
                {!isOpen ? null : showSpinner ? (
                  <div className="run-stage-note">
                    <Spinner label="Loading events…" />
                  </div>
                ) : (
                  <>
                    {group.items.length === 0 && !holdsDecision && (
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
