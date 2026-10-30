// src/frontend/components/runs/RunChatLog.tsx — The run chat's log: the six stage groups with their rows,
// the decision card in the decision stage, a failed send with Retry, the resolved line, the typing
// indicator, and Jump to Latest. The log keeps its place while the reader is up the chat.

import "./RunChat.css";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkflowStage } from "../../../shared/types.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import type { StageGroup } from "../../lib/run-stages.js";
import { STATUS_COPY } from "../feedback/copy-map.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { RunStageTimeline } from "./RunStageTimeline.js";

/** How close to the bottom still counts as following the chat. */
const AT_BOTTOM_PX = 48;

const SETTINGS_MODELS = "Settings › Models";

/** The message with its "Settings › Models" pointer made a link to that pane (#263). */
function withSettingsLink(message: string): ReactNode {
  const at = message.indexOf(SETTINGS_MODELS);
  if (at === -1) return message;
  return (
    <>
      {message.slice(0, at)}
      <Link to="/settings?tab=models">{SETTINGS_MODELS}</Link>
      {message.slice(at + SETTINGS_MODELS.length)}
    </>
  );
}

/** Keeps the scroll position while the reader is up the chat, and offers Jump to Latest. */
function useScrollFollow(itemCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(false);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new items when the count changes
  useEffect(() => {
    if (atBottomRef.current) {
      scrollToBottom();
    } else {
      setUnseen(true);
    }
  }, [itemCount]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottomRef.current) setUnseen(false);
  };

  const jumpToLatest = () => {
    atBottomRef.current = true;
    setUnseen(false);
    scrollToBottom();
  };

  return { scrollRef, onScroll, unseen, jumpToLatest };
}

interface RunChatLogProps {
  items: readonly ChatItem[];
  groups: StageGroup[];
  openStages: ReadonlySet<WorkflowStage>;
  onToggleStage: (stage: WorkflowStage) => void;
  now: number;
  retryFor: (item: ChatItem) => (() => void) | undefined;
  decision: ReactNode;
  waiting: boolean;
  /** A failed send to show; `onRetry` is set only while a retry is allowed. */
  failure: { message: string; onRetry?: (() => void) | undefined } | null;
  /** The line for a button just pressed, or null. */
  resolved: string | null;
  sending: boolean;
}

/**
 * What the one status node says: the current stage, the stages that ended the run, the latest
 * result, the latest error, a failed send and "needs you". Progress lines are not announced —
 * the reader sees them in the log (US19, #319).
 */
function announceText(
  items: readonly ChatItem[],
  groups: readonly StageGroup[],
  waiting: boolean,
  failure: { message: string } | null,
): string {
  const parts: string[] = [];
  const current = groups.find((g) => g.state === "current");
  if (current) parts.push(current.label);
  for (const g of groups) {
    if (g.state === "failed") parts.push(`${g.label} failed`);
    if (g.state === "stopped") parts.push(`${g.label} stopped`);
  }
  const result = items.findLast((i) => i.kind === "result");
  if (result?.kind === "result") {
    parts.push(`${result.title} ${result.passed ? "passed" : "did not pass"}`);
  }
  const error = items.findLast((i) => i.kind === "error");
  if (error) parts.push(error.text);
  if (failure) parts.push(failure.message);
  if (waiting) parts.push(STATUS_COPY.needsYou);
  return parts.join(". ");
}

export function RunChatLog({
  items,
  groups,
  openStages,
  onToggleStage,
  now,
  retryFor,
  decision,
  waiting,
  failure,
  resolved,
  sending,
}: RunChatLogProps) {
  const scroll = useScrollFollow(items.length);

  return (
    <div className="run-chat-timeline">
      {/* One small status node announces what changed; the log itself is not a
          live region, so progress lines are read, not announced (US19, #319). */}
      <div className="sr-only" role="status">
        {announceText(items, groups, waiting, failure)}
      </div>
      <div
        className="run-chat-messages run-panel-scroll text-subhead"
        ref={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        {items.length === 0 && (
          <div className="run-chat-note">
            <EmptyState message="Waiting for the first update…" />
          </div>
        )}
        <RunStageTimeline
          groups={groups}
          open={openStages}
          onToggle={onToggleStage}
          now={now}
          retryFor={retryFor}
          decision={decision}
          waiting={waiting}
        />
        {failure && (
          <div className="run-chat-system run-chat-system-error" role="alert">
            <span>{withSettingsLink(failure.message)}</span>
            {failure.onRetry && (
              <Button variant="secondary" size="sm" onPress={failure.onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}
        {resolved && (
          <div className="run-chat-system" data-kind="resolved">
            <span>{resolved}</span>
          </div>
        )}
        {sending && (
          <div
            className="run-chat-typing"
            role="status"
            aria-label="The agent is replying"
          >
            <span className="run-chat-typing-dot" />
            <span className="run-chat-typing-dot" />
            <span className="run-chat-typing-dot" />
          </div>
        )}
      </div>
      {scroll.unseen && (
        <div className="run-chat-jump">
          <Button variant="secondary" size="sm" onPress={scroll.jumpToLatest}>
            Jump to Latest
          </Button>
        </div>
      )}
    </div>
  );
}
