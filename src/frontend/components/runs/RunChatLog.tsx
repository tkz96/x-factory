// src/frontend/components/runs/RunChatLog.tsx — The run chat's log: the six stage groups with their rows,
// the decision card in the decision stage, a failed send with Retry, the resolved line, the typing
// indicator, and Jump to Latest. The log keeps its place while the reader is up the chat.

import "./RunChat.css";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkflowStage } from "../../../shared/types.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import type { Attempt, StageGroup } from "../../lib/run-stages.js";
import { STATUS_COPY } from "../feedback/copy-map.js";
import { Button } from "../ui/Button.js";
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

  // Brings the newest item into view: the last row or decision card that is on screen (not in a
  // folded stage or attempt). Falls back to the bottom when there is none.
  const followNewest = () => {
    const el = scrollRef.current;
    if (!el) return;
    const visible = Array.from(
      el.querySelectorAll<HTMLElement>(
        ".run-stage-panel > :not(.run-stage-note), .run-stage-decision",
      ),
    ).filter((node) => !node.closest("[inert], [hidden]"));
    const newest = visible.at(-1);
    if (newest) newest.scrollIntoView({ block: "end" });
    else scrollToBottom();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new items when the count changes
  useEffect(() => {
    if (atBottomRef.current) {
      followNewest();
    } else {
      setUnseen(true);
    }
  }, [itemCount]);

  // The content grows when a stage opens, a row arrives or an attempt starts. While the reader is
  // at the end, the newest content stays in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observe the current children each time the count changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) followNewest();
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
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
  attempts?: readonly Attempt[] | undefined;
  openStages: ReadonlySet<WorkflowStage>;
  onToggleStage: (stage: WorkflowStage) => void;
  retryFor: (item: ChatItem) => (() => void) | undefined;
  decision: ReactNode;
  /** A failed send to show; `onRetry` is set only while a retry is allowed. */
  failure: { message: string; onRetry?: (() => void) | undefined } | null;
  /** The line for a button just pressed, or null. */
  resolved: string | null;
  sending: boolean;
  /** The run waits on the reader; feeds the status node's "needs you" (US19, #319). */
  waiting: boolean;
  /** True once the stream has opened or any event has arrived (#313). Defaults to true. */
  eventsLoaded?: boolean | undefined;
  /** The note shown when the current stage is empty and events are loaded (#313). */
  emptyStageNote?: string | undefined;
}

/**
 * What the status node can say: the current stage, the stages that ended the run, the latest
 * result, the latest error, a failed send and "needs you". Progress lines are not announced —
 * the reader sees them in the log (US19, #319).
 */
function announceParts(
  items: readonly ChatItem[],
  groups: readonly StageGroup[],
  waiting: boolean,
  failure: { message: string } | null,
): string[] {
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
  return parts;
}

/**
 * The one status node's text: only the parts that are new since the last render, so a reader hears
 * a new stage, a new result, a new error or "needs you" once, and not the whole state again.
 */
function useAnnouncement(parts: readonly string[]): string {
  const key = parts.join("\n");
  const [seen, setSeen] = useState({ key, parts, text: parts.join(". ") });
  if (seen.key !== key) {
    const added = parts.filter((part) => !seen.parts.includes(part));
    setSeen({ key, parts, text: added.join(". ") });
  }
  return seen.key === key
    ? seen.text
    : parts.filter((p) => !seen.parts.includes(p)).join(". ");
}

export function RunChatLog({
  items,
  groups,
  attempts,
  openStages,
  onToggleStage,
  retryFor,
  decision,
  failure,
  resolved,
  sending,
  waiting,
  eventsLoaded = true,
  emptyStageNote,
}: RunChatLogProps) {
  const scroll = useScrollFollow(items.length);
  const announcement = useAnnouncement(
    announceParts(items, groups, waiting, failure),
  );

  return (
    <div className="run-chat-timeline">
      {/* One small status node announces what changed; the log itself is not a
          live region, so progress lines are read, not announced (US19, #319). */}
      <div className="sr-only" role="status">
        {announcement}
      </div>
      <div
        className="run-chat-messages run-panel-scroll text-subhead"
        ref={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        <RunStageTimeline
          groups={groups}
          attempts={attempts}
          open={openStages}
          onToggle={onToggleStage}
          retryFor={retryFor}
          decision={decision}
          eventsLoaded={eventsLoaded}
          emptyNote={emptyStageNote}
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
