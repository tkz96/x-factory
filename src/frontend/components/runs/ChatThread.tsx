// src/frontend/components/runs/ChatThread.tsx — Continuous chat thread streaming events and Ralph progress (Ticket 02).

import "./ChatThread.css";

import { useEffect, useRef } from "react";
import type { CanonicalWireEvent } from "../../hooks/useRunSSE.js";

export interface ChatThreadProps {
  events: CanonicalWireEvent[];
}

function getPayloadRecord(item: CanonicalWireEvent): Record<string, unknown> {
  return (
    item.payload && typeof item.payload === "object" ? item.payload : {}
  ) as Record<string, unknown>;
}

function renderStatusBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const status = typeof payload.status === "string" ? payload.status : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Status</span>
        <span>[{status.toUpperCase()}]</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
    </div>
  );
}

function renderEvidenceBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const summary =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.evidence === "string"
        ? payload.evidence
        : "";
  return (
    <div key={item.id} className="chat-bubble bubble-evidence">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Evidence</span>
        {stage && <strong>{stage.toUpperCase()}</strong>}
      </div>
      <div className="chat-bubble-body">✓ {summary}</div>
    </div>
  );
}

function renderRalphBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const iteration = payload.iteration;
  const task = payload.task;
  return (
    <div key={item.id} className="chat-bubble bubble-ralph">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Ralph Loop</span>
        {iteration ? <span>Iteration #{String(iteration)}</span> : null}
        {task ? <span>· {String(task)}</span> : null}
      </div>
      <div className="chat-bubble-body">{text}</div>
    </div>
  );
}

function renderPiChunkBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
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
    </div>
  );
}

function renderSteerBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.message === "string"
        ? payload.message
        : "";
  return (
    <div key={item.id} className="chat-bubble bubble-steer">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">You</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
    </div>
  );
}

function renderErrorBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : "";
  return (
    <div key={item.id} className="chat-bubble bubble-error">
      <div className="chat-bubble-header">
        <span className="chat-bubble-badge">Error</span>
      </div>
      <div className="chat-bubble-body">{text}</div>
    </div>
  );
}

function renderDefaultBubble(
  item: CanonicalWireEvent,
  payload: Record<string, unknown>,
) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof item.payload === "string"
        ? item.payload
        : JSON.stringify(item.payload ?? item);

  return (
    <div key={item.id} className="chat-bubble bubble-system">
      <div className="chat-bubble-body">{text}</div>
    </div>
  );
}

function renderBubble(item: CanonicalWireEvent) {
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
    case "steer":
      return renderSteerBubble(item, payload);
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
