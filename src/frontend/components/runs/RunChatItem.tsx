// src/frontend/components/runs/RunChatItem.tsx — One row of the run chat (#261).
//
// Each kind of chat item has one row shape. Every time goes through RunTime, so a moment
// reads the same everywhere: relative when recent, the exact time on hover.

import type { DiffFileSummary } from "../../../shared/diff-summary.js";
import {
  formatRelativeTime,
  formatTimestamp,
} from "../../lib/format-timestamp.js";
import type { ChatItem } from "../../lib/run-chat-items.js";
import { MotionEntry } from "../../motion/MotionEntry.js";
import { MarkdownViewer } from "../MarkdownViewer.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";

export function RunTime({ at, now }: { at: string; now: number }) {
  return (
    <time className="run-chat-time" dateTime={at} title={formatTimestamp(at)}>
      {formatRelativeTime(at, now)}
    </time>
  );
}

export interface RunChatItemProps {
  item: ChatItem;
  now: number;
  onOpenFile: (file: DiffFileSummary) => void;
  /** Re-sends the message before a trailing error (#263); absent when a retry is not offered. */
  onRetry?: (() => void) | undefined;
}

function Status({
  item,
  now,
}: {
  item: Extract<ChatItem, { kind: "status" }>;
  now: number;
}) {
  return (
    <div className="run-chat-system" data-kind="status">
      <span>{item.label}</span>
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
  now: number;
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
      {link ? (
        <a href={link} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onPress={onRetry}>
          Retry
        </Button>
      )}
      <RunTime at={item.at} now={now} />
    </div>
  );
}

export function RunChatItemView({
  item,
  now,
  onOpenFile,
  onRetry,
}: RunChatItemProps) {
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
        <div className="run-chat-system" data-kind="evidence">
          <span>
            <strong>{item.stage}</strong>: {item.text}
          </span>
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "plan":
      return (
        <article className="run-chat-card" data-kind="plan" aria-label="Plan">
          <h3>Plan</h3>
          <p className="run-chat-pre">{item.plan}</p>
          <RunTime at={item.at} now={now} />
        </article>
      );
    case "diff":
      return (
        <article
          className="run-chat-card"
          data-kind="diff"
          aria-label="Changes"
        >
          <h3>
            Changes: {item.summary.files.length}{" "}
            {item.summary.files.length === 1 ? "file" : "files"}
          </h3>
          <ul className="run-chat-files">
            {item.summary.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="run-chat-file"
                  onClick={() => onOpenFile(file)}
                >
                  <span className="run-chat-file-name">{file.path}</span>
                  <span className="run-chat-file-add">{`+${file.added}`}</span>
                  <span className="run-chat-file-remove">{`−${file.removed}`}</span>
                </button>
              </li>
            ))}
          </ul>
          <RunTime at={item.at} now={now} />
        </article>
      );
    case "review":
      return (
        <div className="run-chat-system" data-kind="review">
          <span>{item.tool ? `Ran ${item.tool}` : item.text}</span>
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "result":
      return (
        <div className="run-chat-system" data-kind="result">
          <span>
            <strong>
              {item.title} {item.passed ? "passed" : "did not pass"}
            </strong>
            {item.summary ? `: ${item.summary}` : ""}
          </span>
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "progress":
      return (
        <div className="run-chat-progress" data-kind="progress">
          <Badge className="run-chat-badge">Iteration {item.iteration}</Badge>
          <span>{item.text}</span>
          <RunTime at={item.at} now={now} />
        </div>
      );
    case "output":
      return (
        <div
          className={`run-chat-bubble run-chat-bubble-${item.speaker}`}
          data-kind="output"
        >
          <Badge className="run-chat-badge">
            {item.speaker === "reviewer" ? "Reviewer" : "Builder"}
          </Badge>
          <p className="run-chat-pre">{item.text}</p>
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
            <div className="run-chat-markdown">
              <MarkdownViewer content={item.text} />
            </div>
          ) : (
            <p className="run-chat-pre">{item.text}</p>
          )}
          <RunTime at={item.at} now={now} />
        </div>
      );
  }
}

/** A row with the chat's entry motion; under reduced motion it is a crossfade (#252). */
export function RunChatRow(props: RunChatItemProps) {
  return (
    <MotionEntry className="run-chat-row">
      <RunChatItemView {...props} />
    </MotionEntry>
  );
}
