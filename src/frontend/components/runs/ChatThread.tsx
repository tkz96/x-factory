// src/frontend/components/runs/ChatThread.tsx — Continuous chat thread streaming events and Ralph progress (Ticket 02, #191).

import "./ChatThread.css";

import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";

export interface ChatThreadProps {
  events: RunEvent[];
}

function formatFullTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return iso;
  }
}

function renderStatusBubble(item: RunEvent<"status">) {
  const { status, text } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Status</span>
        <span>[{status.toUpperCase()}]</span>
      </div>
      <div className="chat-bubble-body">{text ?? ""}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderEvidenceBubble(item: RunEvent<"stage_evidence">) {
  const { stage, evidence } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-evidence">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Evidence</span>
        {stage && <strong>{stage.toUpperCase()}</strong>}
      </div>
      <div className="chat-bubble-body">✓ {evidence}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderRalphBubble(item: RunEvent<"ralph_progress">) {
  const { text, iteration } = item.payload;
  return (
    <div key={item.id} className="chat-bubble bubble-ralph">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Ralph Loop</span>
        {iteration ? <span>Iteration #{String(iteration)}</span> : null}
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
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
  const badgeLabel = isRalph
    ? "Ralph"
    : role === "reviewer"
      ? "Reviewer"
      : "Pi Agent";

  return (
    <div key={item.id} className={bubbleClass}>
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">{badgeLabel}</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderSteerBubble(item: RunEvent<"steer">) {
  return (
    <div key={item.id} className="chat-bubble bubble-steer">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Steer Action</span>
      </div>
      <div className="chat-bubble-body">{item.payload.message}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
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
        <span className="chat-bubble-badge">Chat</span>
        <strong>User Message Sent</strong>
      </div>
      <div className="chat-bubble-body">
        {snippet || "User sent message in chat"}
      </div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderChatAgentBubble(item: RunEvent<"chat_agent">) {
  const snippet = snippetOf(item.payload.text);
  return (
    <div key={item.id} className="chat-bubble bubble-chat-agent">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Chat</span>
        <strong>Agent Response Received</strong>
      </div>
      <div className="chat-bubble-body">
        {snippet || "Agent replied in chat"}
      </div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderErrorBubble(item: RunEvent<"error">) {
  return (
    <div key={item.id} className="chat-bubble bubble-error">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Error</span>
      </div>
      <div className="chat-bubble-body">{item.payload.message}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderTextBubble(item: RunEvent, text: string) {
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
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
    case "steer":
      return renderSteerBubble(item);
    case "chat_user":
      return renderChatUserBubble(item);
    case "chat_agent":
      return renderChatAgentBubble(item);
    case "error":
      return renderErrorBubble(item);
    case "info":
    case "user_feedback":
      return renderTextBubble(item, item.payload.text);
    case "pr_step":
      return renderTextBubble(
        item,
        item.payload.text ?? item.payload.url ?? "",
      );
    case "verification":
    case "review":
      return renderTextBubble(item, JSON.stringify(item.payload));
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

export function ChatThread({ events }: ChatThreadProps) {
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
      className="chat-thread-container event-log"
      aria-live="polite"
      role="log"
    >
      {events.length === 0 ? (
        <div className="chat-thread-empty">Awaiting pipeline messages…</div>
      ) : (
        events.map((event) => renderBubble(event))
      )}
    </div>
  );
}
