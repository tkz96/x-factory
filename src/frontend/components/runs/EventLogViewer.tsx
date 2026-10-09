// src/frontend/components/runs/EventLogViewer.tsx — Real-time auto-scrolling SSE activity log (XFM-50).

import "./EventLogViewer.css";

import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";

interface EventLogViewerProps {
  events: RunEvent[];
}

function getPayloadRecord(item: RunEvent): Record<string, unknown> {
  return (
    item.payload && typeof item.payload === "object" ? item.payload : {}
  ) as Record<string, unknown>;
}

function renderStatus(item: RunEvent, payload: Record<string, unknown>) {
  const status = typeof payload.status === "string" ? payload.status : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  return (
    <div key={item.id} className="event-item event-status">
      [{status.toUpperCase()}] {text}
    </div>
  );
}

function renderEvidence(item: RunEvent, payload: Record<string, unknown>) {
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const summary = typeof payload.evidence === "string" ? payload.evidence : "";
  return (
    <div key={item.id} className="event-item event-evidence">
      <span className="event-prefix">✓ </span>
      {stage && <strong>{stage.toUpperCase()}: </strong>}
      {summary}
    </div>
  );
}

function renderPiChunk(item: RunEvent, payload: Record<string, unknown>) {
  const role = typeof payload.role === "string" ? payload.role : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const rolePrefix =
    role === "reviewer" ? "[Reviewer] " : role === "ralph" ? "[Ralph] " : "";
  return (
    <div key={item.id} className="event-item">
      {rolePrefix}
      {text}
    </div>
  );
}

function renderRalphProgress(item: RunEvent, payload: Record<string, unknown>) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const iteration = payload.iteration;
  return (
    <div key={item.id} className="event-item event-ralph">
      <span className="event-prefix">⚙ [Ralph] </span>
      {iteration ? <span>[Iter #{String(iteration)}] </span> : null}
      {text}
    </div>
  );
}

function renderPrStep(item: RunEvent, payload: Record<string, unknown>) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.url === "string"
        ? payload.url
        : typeof payload.step === "string"
          ? payload.step
          : "";
  return (
    <div key={item.id} className="event-item event-status">
      <span className="event-prefix">▸ </span>
      {text}
    </div>
  );
}

function renderEvalResult(
  item: RunEvent,
  payload: Record<string, unknown>,
  label: "Verification" | "Review",
) {
  const res = (
    payload.result && typeof payload.result === "object"
      ? payload.result
      : payload
  ) as { passed?: boolean; summary?: string };
  const passed = Boolean(res.passed);
  const summary = typeof res.summary === "string" ? res.summary : "";
  return (
    <div
      key={item.id}
      className={`event-item ${passed ? "event-status" : "event-error"}`}
    >
      {label}: {summary}
    </div>
  );
}

function renderError(item: RunEvent, payload: Record<string, unknown>) {
  const text = typeof payload.message === "string" ? payload.message : "";
  return (
    <div key={item.id} className="event-item event-error">
      Error: {text}
    </div>
  );
}

function renderInfo(item: RunEvent, payload: Record<string, unknown>) {
  const text = typeof payload.text === "string" ? payload.text : "";
  return (
    <div key={item.id} className="event-item text-muted">
      {text}
    </div>
  );
}

function renderFallback(item: RunEvent, payload: Record<string, unknown>) {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof item.payload === "string"
        ? item.payload
        : JSON.stringify(item.payload ?? item);
  return (
    <div key={item.id} className="event-item text-muted">
      {text}
    </div>
  );
}

function renderEventItem(item: RunEvent) {
  const payload = getPayloadRecord(item);

  switch (item.type) {
    case "status":
      return renderStatus(item, payload);
    case "stage_evidence":
      return renderEvidence(item, payload);
    case "pi_output_chunk":
      return renderPiChunk(item, payload);
    case "pr_step":
      return renderPrStep(item, payload);
    case "verification":
      return renderEvalResult(item, payload, "Verification");
    case "review":
      return renderEvalResult(item, payload, "Review");
    case "error":
      return renderError(item, payload);
    case "ralph_progress":
      return renderRalphProgress(item, payload);
    case "info":
      return renderInfo(item, payload);
    default:
      return renderFallback(item, payload);
  }
}

export function EventLogViewer({ events }: EventLogViewerProps) {
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
      id="event-log"
      ref={containerRef}
      className="event-log"
      aria-live="polite"
      role="log"
    >
      {events.length === 0 ? (
        <span className="text-muted">Awaiting pipeline events…</span>
      ) : (
        events.map((event) => renderEventItem(event))
      )}
    </div>
  );
}
