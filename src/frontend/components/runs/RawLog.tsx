// src/frontend/components/runs/RawLog.tsx — The raw event log, as chat bubbles (#191; renamed from
// ChatThread, spec #312 ticket 10). It renders the chat items the one mapping gives it, so the raw
// log and the run chat read events the same way.

import { stageLabel, stageStartedText } from "../../lib/run-models.js";
import { runStatusText } from "../../lib/run-status-ui.js";
import "./RawLog.css";

import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";
import { formatTimestamp } from "../../lib/format-timestamp.js";
import { Badge } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";

export interface RawLogProps {
  events: RunEvent[];
}

function renderStatusBubble(item: RunEvent<"status">) {
  const { status, text } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge">Status</Badge>
        <span>{runStatusText(status)}</span>
      </div>
      <div className="chat-bubble-body">{text ?? ""}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderEvidenceBubble(item: RunEvent<"stage_evidence">) {
  const { stage, evidence } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-evidence">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge">Evidence</Badge>
        {stage && <strong>{stageLabel(stage)}</strong>}
      </div>
      <div className="chat-bubble-body">✓ {evidence}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderRalphBubble(item: RunEvent<"ralph_progress">) {
  const { text, iteration } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-ralph">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge" tone="accent">
          Progress
        </Badge>
        {iteration ? <span>Iteration #{String(iteration)}</span> : null}
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderPiChunkBubble(item: RunEvent<"pi_output_chunk">) {
  const { role, text } = item.payload;
  const isRalph = role === "ralph";
  const bubbleClass = isRalph
    ? "chat-bubble bubble-ralph"
    : "chat-bubble bubble-agent";
  // The roles the redesign names (#278): the Builder writes, the Reviewer reads.
  const badgeLabel = role === "reviewer" ? "Reviewer" : "Builder";

  return (
    <div key={item.id} className={bubbleClass}>
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge">{badgeLabel}</Badge>
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function snippetOf(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function renderChatUserBubble(item: RunEvent<"chat_user">) {
  const snippet = snippetOf(item.payload.text);
  return (
    <div key={item.id} className="chat-bubble bubble-chat-user">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge">Chat</Badge>
        <strong>User Message Sent</strong>
      </div>
      <div className="chat-bubble-body">
        {snippet || "User sent message in chat"}
      </div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderChatAgentBubble(item: RunEvent<"chat_agent">) {
  const snippet = snippetOf(item.payload.text);
  return (
    <div key={item.id} className="chat-bubble bubble-chat-agent">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge">Chat</Badge>
        <strong>Agent Response Received</strong>
      </div>
      <div className="chat-bubble-body">
        {snippet || "Agent replied in chat"}
      </div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderErrorBubble(item: RunEvent<"error">) {
  return (
    <div key={item.id} className="chat-bubble bubble-error">
      <div className="chat-bubble-header">
        <Badge className="chat-bubble-badge" tone="error">
          Error
        </Badge>
      </div>
      <div className="chat-bubble-body">{item.payload.message}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderInfoBubble(item: RunEvent<"info">) {
  const text = item.payload.text;
  if (item.payload.warning === "unsandboxed") {
    return (
      <div key={item.id} className="chat-bubble bubble-warning">
        <div className="chat-bubble-header">
          <Badge className="chat-bubble-badge" tone="warning">
            Warning
          </Badge>
        </div>
        <div className="chat-bubble-body">{text}</div>
        <time
          className="chat-bubble-time text-caption-2"
          dateTime={item.timestamp}
        >
          {formatTimestamp(item.timestamp)}
        </time>
      </div>
    );
  }
  return renderTextBubble(item, text);
}

function renderTextBubble(item: RunEvent, text: string) {
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-body">{text}</div>
      <time
        className="chat-bubble-time text-caption-2"
        dateTime={item.timestamp}
      >
        {formatTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

/**
 * A type this client does not know, such as a leftover `steer` row from an old database.
 * It renders as a neutral line: the payload's text, its raw string, or its JSON.
 */
function renderFallbackBubble(item: RunEvent) {
  const { payload } = item;
  const text =
    typeof payload === "string"
      ? payload
      : (payloadText(payload) ?? JSON.stringify(payload ?? item));
  return renderTextBubble(item, text);
}

function payloadText(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "text" in payload) {
    return typeof payload.text === "string" ? payload.text : undefined;
  }
  return undefined;
}

/** Renders one event. Each case reads the payload its event type declares, so there are no casts. */
function renderBubble(item: RunEvent) {
  switch (item.type) {
    case "status":
      return renderStatusBubble(item);
    case "stage_evidence":
      return renderEvidenceBubble(item);
    case "ralph_progress":
      return renderRalphBubble(item);
    case "pi_output_chunk":
      return renderPiChunkBubble(item);
    case "chat_user":
      return renderChatUserBubble(item);
    case "chat_agent":
      return renderChatAgentBubble(item);
    case "error":
      return renderErrorBubble(item);
    case "info":
      return renderInfoBubble(item);
    case "user_feedback":
      return renderTextBubble(item, item.payload.text);
    case "pr_step":
      return renderTextBubble(
        item,
        item.payload.text ?? item.payload.url ?? "",
      );
    case "stage_started":
      return renderTextBubble(item, stageStartedText(item.payload));
    case "verification":
    case "review":
      return renderTextBubble(item, JSON.stringify(item.payload));
    default:
      return renderFallbackBubble(item);
  }
}

export function RawLog({ events }: RawLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new events
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      id="chat-thread"
      ref={containerRef}
      className="chat-thread-container text-subhead"
      aria-live="polite"
      role="log"
    >
      {events.length === 0 ? (
        <div className="chat-thread-note">
          <EmptyState message="Waiting for the first update…" />
        </div>
      ) : (
        events.map((event) => renderBubble(event))
      )}
    </div>
  );
}
