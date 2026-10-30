// src/frontend/components/runs/RunChatItem.tsx — One row of the run chat (#261).
//
// Each kind of chat item has one row shape. Every time goes through RunTime, so a moment
// reads the same everywhere: relative within the hour, then the time of day, the full date
// and time on hover.

import { memo, type ReactNode } from "react";
import {
  formatTimelineTime,
  formatTimestamp,
} from "../../lib/format-timestamp.js";
import { useMinuteNow } from "../../lib/minute-ticker.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import { MotionEntry } from "../../motion/MotionEntry.js";
import { MarkdownBlock } from "../MarkdownBlock.js";
import { MarkdownScaleContext, MarkdownViewer } from "../MarkdownViewer.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Icon } from "../ui/Icon.js";
import { type RunDetailsSection, useShowDetails } from "./RunDetailsContext.js";

/** A time label. It reads the shared minute ticker; `now` pins the clock (tests, fixed views). */
export function RunTime({
  at,
  now,
}: {
  at: string;
  now?: number | undefined;
}) {
  const shared = useMinuteNow();
  now ??= shared;
  return (
    <time
      className="run-chat-time text-caption-2"
      dateTime={at}
      title={formatTimestamp(at)}
    >
      {formatTimelineTime(at, now)}
    </time>
  );
}

/**
 * One line that names a result: what happened, and the time. When Run details holds the full
 * list (files, criteria), the line is a button that brings that section into view.
 */
function SummaryLine({
  kind,
  icon,
  tone,
  section,
  at,
  now,
  children,
}: {
  kind: ChatItem["kind"];
  icon: string;
  tone?: "success" | "error" | undefined;
  section?: RunDetailsSection | undefined;
  at: string;
  now?: number | undefined;
  children: ReactNode;
}) {
  const showDetails = useShowDetails();
  const body = (
    <>
      <Icon
        name={icon}
        size="sm"
        className={`run-chat-summary-icon${tone ? ` run-chat-summary-icon--${tone}` : ""}`}
      />
      <div className="run-chat-summary-text">{children}</div>
      <RunTime at={at} now={now} />
    </>
  );
  if (section && showDetails) {
    return (
      <Button
        variant="quiet"
        className="run-chat-summary ui-row-hover text-callout"
        data-kind={kind}
        onPress={() => showDetails(section)}
      >
        {body}
      </Button>
    );
  }
  return (
    <div className="run-chat-summary text-callout" data-kind={kind}>
      {body}
    </div>
  );
}

export interface RunChatItemProps {
  item: ChatItem;
  now?: number | undefined;
  /** Re-sends the message before a trailing error (#263); absent when a retry is not offered. */
  onRetry?: (() => void) | undefined;
}

function Status({
  item,
  now,
}: {
  item: Extract<ChatItem, { kind: "status" }>;
  now?: number | undefined;
}) {
  return (
    <div className="run-chat-system" data-kind="status">
      <span className="run-chat-system-text">{item.label}</span>
      <RunTime at={item.at} now={now} />
      {item.failure && (
        <div className="run-chat-failure">
          <strong>{item.failure.message}</strong>
          <p>{item.failure.recovery}</p>
        </div>
      )}
    </div>
  );
}

function SystemLine({
  item,
  now,
  tone,
  onRetry,
}: {
  item: ChatItem;
  now?: number | undefined;
  tone?: "warning" | "error" | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const text = "text" in item ? item.text : "";
  const link = item.kind === "notice" && item.url ? item.url : undefined;
  return (
    <div
      className={`run-chat-system${tone ? ` run-chat-system-${tone}` : ""}`}
      data-kind={item.kind}
    >
      <span className="run-chat-system-text">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer">
            {text}
          </a>
        ) : (
          text
        )}
      </span>
      {onRetry && (
        <Button variant="secondary" size="sm" onPress={onRetry}>
          Retry
        </Button>
      )}
      <RunTime at={item.at} now={now} />
    </div>
  );
}

/** A count of nothing is not a change: it takes the secondary color. */
function zeroClass(base: string, count: number): string {
  return count === 0 ? `${base} run-chat-zero` : base;
}

export function RunChatItemView({ item, now, onRetry }: RunChatItemProps) {
  switch (item.kind) {
    case "status":
      return <Status item={item} now={now} />;
    case "notice":
      return (
        <SystemLine
          item={item}
          now={now}
          tone={item.warning ? "warning" : undefined}
        />
      );
    case "stage":
      return (
        <SystemLine
          item={{ ...item, kind: "notice", warning: false }}
          now={now}
        />
      );
    case "error":
      return (
        <SystemLine item={item} now={now} tone="error" onRetry={onRetry} />
      );
    case "evidence":
      return (
        <SummaryLine kind="evidence" icon="icon-check" at={item.at} now={now}>
          <MarkdownScaleContext.Provider value="compact">
            <MarkdownViewer content={item.text} />
          </MarkdownScaleContext.Provider>
        </SummaryLine>
      );
    case "plan":
      return (
        <article data-kind="plan" aria-label="Plan">
          <Card variant="chat" className="text-callout">
            <MarkdownBlock content={item.plan} label="Plan" compact />
            <RunTime at={item.at} now={now} />
          </Card>
        </article>
      );
    case "diff": {
      const { files, totalAdded, totalRemoved } = item.summary;
      return (
        <SummaryLine
          kind="diff"
          icon="icon-code"
          section="files"
          at={item.at}
          now={now}
        >
          {`${files.length} ${files.length === 1 ? "file" : "files"} changed`}
          <span className="run-chat-summary-counts">
            <span
              className={zeroClass("run-chat-add", totalAdded)}
            >{`+${totalAdded}`}</span>
            <span
              className={zeroClass("run-chat-remove", totalRemoved)}
            >{`−${totalRemoved}`}</span>
          </span>
        </SummaryLine>
      );
    }
    case "review":
      return item.tool ? (
        <div className="run-chat-system" data-kind="review">
          <span className="run-chat-system-text">{`Ran ${item.tool}`}</span>
          <RunTime at={item.at} now={now} />
        </div>
      ) : (
        <div data-kind="review">
          <Card variant="chat" className="text-callout">
            <MarkdownBlock content={item.text ?? ""} compact />
            <RunTime at={item.at} now={now} />
          </Card>
        </div>
      );
    case "result":
      return (
        <SummaryLine
          kind="result"
          icon={item.passed ? "icon-check-circle-2" : "icon-x-circle"}
          tone={item.passed ? "success" : "error"}
          section="evidence"
          at={item.at}
          now={now}
        >
          <strong>{`${item.title} ${item.passed ? "passed" : "did not pass"}`}</strong>
          {item.summary && (
            <span className="run-chat-summary-note">{item.summary}</span>
          )}
        </SummaryLine>
      );
    case "progress":
      return (
        <div className="run-chat-system run-chat-progress" data-kind="progress">
          {!item.sameIteration && (
            <Badge className="run-chat-badge">Iteration {item.iteration}</Badge>
          )}
          <span className="run-chat-system-text">{item.text}</span>
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "output":
      return (
        <div
          className={`run-chat-bubble run-chat-bubble-${item.speaker}`}
          data-kind="output"
        >
          <span className="run-chat-speaker text-caption-1">
            {item.speaker === "reviewer" ? "Reviewer" : "Builder"}
          </span>
          <MarkdownBlock content={item.text} compact />
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "message":
      return (
        <div
          className={`run-chat-bubble run-chat-bubble-${item.role}`}
          data-kind="message"
        >
          {/* The Builder answers in Markdown; the shared renderer never makes
              HTML from it. The reader's own words stay exactly as typed. */}
          {item.role === "agent" ? (
            <>
              <span className="run-chat-speaker">Builder</span>
              <MarkdownBlock content={item.text} compact />
            </>
          ) : (
            <p className="run-chat-pre">{item.text}</p>
          )}
          <RunTime at={item.at} now={now} />
        </div>
      );
  }
}

/** A row with the chat's entry motion; under reduced motion it is a crossfade (#252). */
function RunChatRowView(props: RunChatItemProps) {
  return (
    <MotionEntry className="run-chat-row">
      <RunChatItemView {...props} />
    </MotionEntry>
  );
}

/** Memoised: a row renders again only when its item, pinned time or retry changes (#321). */
export const RunChatRow = memo(RunChatRowView);
