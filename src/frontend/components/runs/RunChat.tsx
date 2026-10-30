// src/frontend/components/runs/RunChat.tsx — The run chat: real run events, one clock, one status map (#261).
// The chat composes its header strip, log, decision card and message box; the send, checkpoint and
// stage-open state live in their hooks.

import "./RunChat.css";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  canRunAction,
  TERMINAL_RUN_STATUSES,
} from "../../../shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../../../shared/types.js";
import {
  type ChatItem,
  mapEventsToChatItems,
  PULL_REQUEST_LINK_TEXT,
} from "../../lib/run-chat-items.js";
import { runNow } from "../../lib/run-now.js";
import { groupItemsByStage, type StageGroup } from "../../lib/run-stages.js";
import { NEEDS_YOU_STATUSES, runStatusUi } from "../../lib/run-status-ui.js";
import { AlertDialog } from "../overlays/AlertDialog.js";
import { useMediaQuery } from "../ui/useMediaQuery.js";
import { RunChatComposer } from "./RunChatComposer.js";
import { RunChatHeader } from "./RunChatHeader.js";
import { RunChatLog } from "./RunChatLog.js";
import type { CheckpointAction } from "./RunCheckpointBar.js";
import { decisionShows, RunDecisionCard } from "./RunDecisionCard.js";
import { useCheckpointFlow } from "./useCheckpointFlow.js";
import { useRunChatSend } from "./useRunChatSend.js";
import { useStageOpenState } from "./useStageOpenState.js";

export interface RunChatProps {
  run: Run;
  events: RunEvent[];
  /** Called with the checkpoint action; a rework carries the reader's notes. */
  onAction?: (action: CheckpointAction, notes?: string) => void;
  /** The checkpoint action in flight, if any (optimistic pending label). */
  pending?: CheckpointAction | null;
  /** True when the last checkpoint action raced with the run and lost. */
  conflict?: boolean;
  /** At phone width, the control that opens the run details, shown at the end of the header strip. */
  detailsTrigger?: ReactNode;
  /** True once the stream has opened or any event has arrived (#313). Defaults to true. */
  eventsLoaded?: boolean | undefined;
}

/** Below the phone breakpoint (768px, as the app shell's) the header strip shows only what fits. */
const PHONE_QUERY = "(max-width: 768px)";

/** The text of the nearest message the reader sent before `index`, or null. */
function messageBefore(
  items: readonly ChatItem[],
  index: number,
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "message" && item.role === "user") return item.text;
  }
  return null;
}

type MessageItem = Extract<ChatItem, { kind: "message" }>;

function isUserMessage(item: ChatItem): item is MessageItem & { role: "user" } {
  return item.kind === "message" && item.role === "user";
}

/**
 * The chat's rows: the run's events, with the reader's own lines from this view (dropped once the
 * worker's copy arrives), and a failed run's last status line without its failure (the header states it).
 */
function chatItemsFor(
  realItems: ChatItem[],
  localItems: ChatItem[],
  status: RunStatus,
  baselines: ReadonlyMap<string, number>,
): ChatItem[] {
  // An echo clears only when the run's own copy of it arrives (#317): for each text, the copies
  // beyond the count at send time confirm that text's echoes, oldest first, one copy for one echo.
  const realCounts = new Map<string, number>();
  for (const real of realItems.filter(isUserMessage)) {
    realCounts.set(real.text, (realCounts.get(real.text) ?? 0) + 1);
  }
  const confirmedLeft = new Map<string, number>();
  const visibleLocalItems = localItems.filter((local) => {
    if (!isUserMessage(local)) return true;
    let left = confirmedLeft.get(local.text);
    if (left === undefined) {
      left = Math.max(
        0,
        (realCounts.get(local.text) ?? 0) - (baselines.get(local.id) ?? 0),
      );
    }
    confirmedLeft.set(local.text, Math.max(0, left - 1));
    return left <= 0;
  });

  const lastStatus = realItems.findLast((i) => i.kind === "status");
  return [
    ...realItems.map((item) =>
      status === "failed" &&
      item === lastStatus &&
      item.kind === "status" &&
      item.failure
        ? withoutFailure(item)
        : item,
    ),
    ...visibleLocalItems,
  ];
}

/** A status item without its failure, kept per item so the row's identity is stable (#321). */
const withoutFailureOf = new WeakMap<ChatItem, ChatItem>();

function withoutFailure(item: ChatItem): ChatItem {
  let copy = withoutFailureOf.get(item);
  if (!copy) {
    copy = { ...item, failure: undefined } as ChatItem;
    withoutFailureOf.set(item, copy);
  }
  return copy;
}

/**
 * The groups without the closing status row that only repeats the decision card's title: the card
 * says what the run asks once. The row is dropped after grouping, so the stages stay as they were.
 */
function withoutRepeatedStatus(
  groups: StageGroup[],
  status: RunStatus,
): StageGroup[] {
  if (!NEEDS_YOU_STATUSES.has(status)) return groups;
  const last = groups
    .flatMap((group) => group.items)
    .findLast((item) => item.kind === "status");
  if (last?.kind !== "status" || last.status !== status) return groups;
  return groups.map((group) =>
    group.items.includes(last)
      ? { ...group, items: group.items.filter((item) => item !== last) }
      : group,
  );
}

/**
 * The groups without what Deliver says a second time: the pull request card names the pull request,
 * so the bare "Pull request link" notice and the evidence line of Deliver are dropped. The stages
 * stay as they were.
 */
function withoutRepeatedDeliver(
  groups: StageGroup[],
  namedByCard: boolean,
): StageGroup[] {
  if (!namedByCard) return groups;
  return groups.map((group) =>
    group.stage === "deliver"
      ? {
          ...group,
          items: group.items.filter(
            (item) =>
              item.kind !== "evidence" &&
              !(item.kind === "notice" && item.text === PULL_REQUEST_LINK_TEXT),
          ),
        }
      : group,
  );
}

/** The label of the stage a failed run failed in, or null. */
function failedStageLabel(groups: readonly StageGroup[]): string | null {
  return groups.find((group) => group.state === "failed")?.label ?? null;
}

export function RunChat({
  run,
  events,
  onAction,
  pending = null,
  conflict = false,
  detailsTrigger,
  eventsLoaded = true,
}: RunChatProps) {
  const narrow = useMediaQuery(PHONE_QUERY);
  const realItems = useMemo(() => mapEventsToChatItems(events), [events]);
  const errorCount = useMemo(
    () => realItems.filter((i) => i.kind === "error").length,
    [realItems],
  );
  const chat = useRunChatSend(
    run.id,
    errorCount,
    (text) =>
      realItems.filter((i) => isUserMessage(i) && i.text === text).length,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const flow = useCheckpointFlow({
    status: run.status,
    onAction,
    addLocal: chat.addLocal,
    inputRef,
  });
  const [input, setInput] = useState("");

  const isApprovalGate = canRunAction(run.status, "chat");
  const finished = TERMINAL_RUN_STATUSES.has(run.status);

  // The rework hint clears when the status changes (#317).
  const lastStatusRef = useRef(run.status);
  useEffect(() => {
    if (lastStatusRef.current !== run.status) {
      lastStatusRef.current = run.status;
      chat.clearReworkHint();
    }
  }, [run.status, chat]);

  // Everything below is memoised on its inputs (#321): a new event rebuilds the lists once, and a
  // re-render for any other reason (typing, a toggle) reuses them.
  const items = useMemo(
    () => chatItemsFor(realItems, chat.localItems, run.status, chat.baselines),
    [realItems, chat.localItems, run.status, chat.baselines],
  );

  // The six stages, and which of them are open.
  const groups = useMemo(
    () =>
      withoutRepeatedDeliver(
        withoutRepeatedStatus(
          groupItemsByStage(items, run, events),
          run.status,
        ),
        run.status === "pr_created",
      ),
    [items, run, events],
  );
  const stages = useStageOpenState(groups);

  // Return and Mod-Enter send; Shift-Return is a new line (see RunChatComposer).
  const submitInput = () => {
    const text = input.trim();
    if (!text || chat.sending || !isApprovalGate || pending !== null) return;
    setInput("");

    if (flow.reworkPrompt) {
      chat.addLocal((id, at) => ({
        id,
        at,
        kind: "message",
        role: "user",
        text,
      }));
      flow.setReworkPrompt(false);
      flow.setPendingRework(text);
      return;
    }

    void chat.send(text, true);
  };

  // The placeholder says what to write, never what the status already says above: the status's own
  // line only guides a run that is waiting on you.
  const ui = runStatusUi(run.status);
  const placeholderText = flow.reworkPrompt
    ? "Describe the changes needed before replanning…"
    : isApprovalGate
      ? ui.placeholder
      : "Message the Builder…";
  const canRetry = isApprovalGate && !chat.sending && pending === null;

  // A trailing error can be retried. Lines the reader just made here do not count as coming after
  // it, and when no earlier message is in the chat the message sent from this view goes again.
  const lastRealIndex = realItems.length - 1;
  const retryFor = (item: ChatItem) => {
    const text =
      canRetry && item.kind === "error" && item.id === items[lastRealIndex]?.id
        ? (messageBefore(items, lastRealIndex) ?? chat.lastSent())
        : null;
    return text === null ? undefined : () => void chat.send(text, false);
  };

  const failure = chat.shownFailure;
  const facts = useMemo(() => runNow(run, events), [run, events]);
  const emptyStageNote = run.waitingForWorker
    ? "Waiting for a worker"
    : facts.title;
  const reworkReady = flow.pendingRework !== null;
  const decision = decisionShows(run, facts, conflict, reworkReady) ? (
    <RunDecisionCard
      run={run}
      facts={facts}
      failedStage={failedStageLabel(groups)}
      pending={pending}
      conflict={conflict}
      reworkReady={reworkReady}
      onAction={flow.handleAction}
    />
  ) : undefined;

  return (
    <div className="run-panel run-chat" id="understanding-chat">
      <RunChatHeader
        run={run}
        events={events}
        pullRequestOutcome={facts.pullRequestOutcome}
        narrow={narrow}
        allOpen={stages.allOpen}
        onToggleAll={stages.toggleAllStages}
        detailsTrigger={detailsTrigger}
      />
      <RunChatLog
        items={items}
        groups={groups}
        openStages={stages.openStages}
        onToggleStage={stages.toggleStage}
        retryFor={retryFor}
        decision={decision}
        failure={
          failure
            ? {
                message: failure.message,
                onRetry: canRetry
                  ? () => void chat.send(failure.text, false)
                  : undefined,
              }
            : null
        }
        resolved={flow.resolved}
        sending={chat.sending}
        waiting={NEEDS_YOU_STATUSES.has(run.status)}
        eventsLoaded={eventsLoaded}
        emptyStageNote={emptyStageNote}
      />
      {/* A finished run takes no more messages: its card offers Start New Run instead. */}
      {!finished && (
        <RunChatComposer
          inputRef={inputRef}
          value={input}
          onChange={setInput}
          onSend={submitInput}
          placeholder={placeholderText}
          inputDisabled={!isApprovalGate || pending !== null}
          sendDisabled={
            !isApprovalGate || !input.trim() || chat.sending || pending !== null
          }
        />
      )}

      <AlertDialog
        id="alert-abandon-run"
        isOpen={flow.abandonOpen}
        onClose={() => flow.setAbandonOpen(false)}
        title={`Abandon run on ${run.branch || "this branch"}?`}
        description="Abandoning ends this run. It can't be undone."
        confirmText="Abandon Run"
        cancelText="Keep Run"
        variant="danger"
        onConfirm={flow.confirmAbandon}
      />
    </div>
  );
}
