// src/frontend/components/runs/RunChat.tsx — The run chat: real run events, one clock, one status map (#261).
// The chat composes its header strip, log, decision card and message box; the send, checkpoint and
// stage-open state live in their hooks.

import "./RunChat.css";

import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  canRunAction,
  TERMINAL_RUN_STATUSES,
} from "../../../shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../../../shared/types.js";
import { useNow } from "../../hooks/useNow.js";
import {
  type ChatItem,
  mapEventsToChatItems,
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

/**
 * The chat's rows: the run's events, with the reader's own lines from this view (dropped once the
 * worker's copy arrives), and a failed run's last status line without its failure (the header states it).
 */
function chatItemsFor(
  realItems: ChatItem[],
  localItems: ChatItem[],
  status: RunStatus,
): ChatItem[] {
  const realUserTexts = new Set(
    realItems.flatMap((i) =>
      i.kind === "message" && i.role === "user" ? [i.text] : [],
    ),
  );
  const lastStatus = realItems.findLast((i) => i.kind === "status");
  return [
    ...realItems.map((item) =>
      status === "failed" &&
      item === lastStatus &&
      item.kind === "status" &&
      item.failure
        ? { ...item, failure: undefined }
        : item,
    ),
    ...localItems.filter(
      (i) => !(i.kind === "message" && realUserTexts.has(i.text)),
    ),
  ];
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
}: RunChatProps) {
  const now = useNow();
  const narrow = useMediaQuery(PHONE_QUERY);
  const realItems = useMemo(() => mapEventsToChatItems(events), [events]);
  const errorCount = realItems.filter((i) => i.kind === "error").length;
  const chat = useRunChatSend(run.id, errorCount);
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
  const items = chatItemsFor(realItems, chat.localItems, run.status);

  // The six stages, and which of them are open.
  const groups = withoutRepeatedStatus(
    groupItemsByStage(items, run, events),
    run.status,
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
  const facts = runNow(run, events);
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
        groups={groups}
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
        now={now}
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
