// src/frontend/components/runs/RawLog.tsx — The raw event log, as chat bubbles (#191; renamed from
// ChatThread, spec #312 ticket 10). Every line comes from the one event mapping
// (mapEventsToChatItems) with the stage labels from workflow-stages.ts, so the raw log and the run
// chat read events the same way, and an event the mapping does not know is dropped, never shown as
// invented text. The log scrolls only while the reader is at the end.

import "./RawLog.css";

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";
import { formatTimestamp } from "../../lib/format-timestamp.js";
import {
  type ChatItem,
  mapEventsToChatItems,
} from "../../lib/run-chat-items.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";

export interface RawLogProps {
  events: RunEvent[];
}

/** How close to the bottom still counts as following the log. */
const AT_BOTTOM_PX = 48;

interface BubbleStyle {
  className: string;
  /** The bubble's text line, when the item has one. */
  text?: string | undefined;
  /** The badge word, when the item names what kind of line it is. */
  badge?: string | undefined;
  tone?: BadgeTone | undefined;
  /** A plain word beside the badge — a stage label or a role. */
  head?: string | undefined;
}

/** One line of the log: its badge and text, and the event's own time. */
function bubble(item: ChatItem, style: BubbleStyle) {
  const { className, text, badge, tone, head } = style;
  return (
    <div key={item.id} className={`chat-bubble ${className}`}>
      {(badge || head) && (
        <div className="chat-bubble-header">
          {badge && (
            <Badge {...(tone ? { tone } : {})} className="chat-bubble-badge">
              {badge}
            </Badge>
          )}
          {head && <strong>{head}</strong>}
        </div>
      )}
      {text !== undefined && <div className="chat-bubble-body">{text}</div>}
      <time className="chat-bubble-time text-caption-2" dateTime={item.at}>
        {formatTimestamp(item.at)}
      </time>
    </div>
  );
}

/** Renders one chat item. Each case reads the fields its kind declares, so there are no casts. */
function bubbleFor(item: ChatItem): ReactNode {
  switch (item.kind) {
    case "status":
      return bubble(item, {
        className: "bubble-system",
        badge: "Status",
        head: item.label,
      });
    case "plan":
      return bubble(item, { className: "bubble-system", text: item.plan });
    case "diff":
      return bubble(item, {
        className: "bubble-system",
        text: `${String(item.summary.files.length)} files · +${String(item.summary.totalAdded)} −${String(item.summary.totalRemoved)}`,
      });
    case "review":
      return bubble(item, {
        className: "bubble-system",
        text: item.text ?? item.tool ?? "",
      });
    case "result":
      return bubble(item, {
        className: "bubble-system",
        text: `${item.title} ${item.passed ? "passed" : "did not pass"}: ${item.summary}`,
      });
    case "progress":
      return bubble(item, {
        className: "bubble-ralph",
        badge: "Progress",
        tone: "accent",
        head: item.sameIteration
          ? undefined
          : `Iteration #${String(item.iteration)}`,
        text: item.text,
      });
    case "output":
      return bubble(item, {
        className: "bubble-agent",
        badge: item.speaker === "reviewer" ? "Reviewer" : "Builder",
        text: item.text,
      });
    case "message":
      return item.role === "user"
        ? bubble(item, {
            className: "bubble-chat-user",
            badge: "You",
            text: item.text,
          })
        : bubble(item, {
            className: "bubble-chat-agent",
            badge: "Agent",
            text: item.text,
          });
    case "evidence":
      return bubble(item, {
        className: "bubble-evidence",
        badge: "Evidence",
        head: item.stage,
        text: `✓ ${item.text}`,
      });
    case "stage":
      return bubble(item, { className: "bubble-system", text: item.text });
    case "notice":
      return item.warning
        ? bubble(item, {
            className: "bubble-warning",
            badge: "Warning",
            tone: "warning",
            text: item.text,
          })
        : bubble(item, { className: "bubble-system", text: item.text });
    case "error":
      return bubble(item, {
        className: "bubble-error",
        badge: "Error",
        tone: "error",
        text: item.text,
      });
  }
}

/** The raw event log of one run, through the chat items the one mapping gives it. */
export function RawLog({ events }: RawLogProps) {
  const items = useMemo(() => mapEventsToChatItems(events), [events]);
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
  };

  // Follow new events only while the reader is at the end; a reader up the log keeps their place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new items when the count changes
  useEffect(() => {
    const el = containerRef.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length]);

  return (
    <div
      id="raw-log"
      ref={containerRef}
      onScroll={onScroll}
      className="chat-thread-container text-subhead"
      aria-live="polite"
      role="log"
    >
      {items.length === 0 ? (
        <div className="chat-thread-note">
          <EmptyState message="Waiting for the first update…" />
        </div>
      ) : (
        items.map((item) => bubbleFor(item))
      )}
    </div>
  );
}
