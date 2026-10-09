// src/frontend/components/runs/ChatThread.tsx — Continuous chat thread streaming events and Ralph progress (Ticket 02).

import "./ChatThread.css";

import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";

export interface ChatThreadProps {
  events: RunEvent[];
}

function getPayloadRecord(item: RunEvent): Record<string, unknown> {
  return (
    item.payload && typeof item.payload === "object" ? item.payload : {}
  ) as Record<string, unknown>;
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

function renderStatusBubble(item: RunEvent, payload: Record<string, unknown>) {
  const status = typeof payload.status === "string" ? payload.status : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Status</span>
        <span>[{status.toUpperCase()}]</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderEvidenceBubble(
  item: RunEvent,
  payload: Record<string, unknown>,
) {
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const summary = typeof payload.evidence === "string" ? payload.evidence : "";
  return (
    <div key={item.id} className="chat-bubble bubble-evidence">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Evidence</span>
        {stage && <strong>{stage.toUpperCase()}</strong>}
      </div>
      <div className="chat-bubble-body">✓ {summary}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderRalphBubble(item: RunEvent, payload: Record<string, unknown>) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const iteration = payload.iteration;
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

function renderPiChunkBubble(item: RunEvent, payload: Record<string, unknown>) {
  const role = typeof payload.role === "string" ? payload.role : "agent";
  const text = typeof payload.text === "string" ? payload.text : "";
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

function renderChatUserBubble(
  item: RunEvent,
  payload: Record<string, unknown>,
) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const snippet = text.length > 80 ? `${text.slice(0, 80)}…` : text;
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

function renderChatAgentBubble(
  item: RunEvent,
  payload: Record<string, unknown>,
) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const snippet = text.length > 80 ? `${text.slice(0, 80)}…` : text;
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

function renderErrorBubble(item: RunEvent, payload: Record<string, unknown>) {
  const text = typeof payload.message === "string" ? payload.message : "";
  return (
    <div key={item.id} className="chat-bubble bubble-error">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Error</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderDefaultBubble(item: RunEvent, payload: Record<string, unknown>) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof item.payload === "string"
        ? item.payload
        : JSON.stringify(item.payload ?? item);

  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-body">{text}</div>
      <time className="chat-bubble-time" dateTime={item.timestamp}>
        {formatFullTimestamp(item.timestamp)}
      </time>
    </div>
  );
}

function renderBubble(item: RunEvent) {
  const payload = getPayloadRecord(item);

  switch (item.type) {
    case "status":
      return renderStatusBubble(item, payload);
    case "stage_evidence":
      return renderEvidenceBubble(item, payload);
    case "ralph_progress":
      return renderRalphBubble(item, payload);
    case "pi_output_chunk":
      return renderPiChunkBubble(item, payload);
    case "chat_user":
      return renderChatUserBubble(item, payload);
    case "chat_agent":
      return renderChatAgentBubble(item, payload);
    case "error":
      return renderErrorBubble(item, payload);
    default:
      return renderDefaultBubble(item, payload);
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
