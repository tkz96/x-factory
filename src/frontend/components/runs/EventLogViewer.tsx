// src/frontend/components/runs/EventLogViewer.tsx — Real-time auto-scrolling SSE activity log (XFM-50).

import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../shared/types.js";

interface EventLogViewerProps {
  events: RunEvent[];
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

  const renderEventItem = (item: RunEvent, index: number) => {
    switch (item.type) {
      case "pi_text": {
        const rolePrefix = item.role === "reviewer" ? "[Reviewer] " : "";
        return (
          <div key={`${item.timestamp}-${index}`} className="event-item">
            {rolePrefix}
            {item.text}
          </div>
        );
      }
      case "status":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-status"
          >
            [{item.status.toUpperCase()}] {item.text}
          </div>
        );
      case "stage_evidence":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-evidence"
          >
            <span className="event-prefix">✓ </span>
            <strong>{item.stage.toUpperCase()}: </strong>
            {item.summary}
          </div>
        );
      case "pi_tool":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-tool"
          >
            <span className="event-prefix">▸ </span>
            <span>{item.tool}</span>
            {item.input && <span className="text-muted"> {item.input}</span>}
          </div>
        );
      case "pi_done":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-status"
          >
            {item.role === "reviewer"
              ? "Reviewer session finished."
              : "Implementation session finished."}
          </div>
        );
      case "pi_error":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-error"
          >
            Pi error: {item.error}
          </div>
        );
      case "error":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-error"
          >
            Error: {item.text}
          </div>
        );
      case "steer":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item event-steer"
          >
            <span className="event-prefix">→ Steer: </span>
            {item.text}
          </div>
        );
      case "verification":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className={`event-item ${item.result.passed ? "event-status" : "event-error"}`}
          >
            Verification: {item.result.summary}
          </div>
        );
      case "review":
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className={`event-item ${item.result.passed ? "event-status" : "event-error"}`}
          >
            Review: {item.result.summary}
          </div>
        );
      default:
        return (
          <div
            key={`${item.timestamp}-${index}`}
            className="event-item text-muted"
          >
            {"text" in item && typeof item.text === "string"
              ? item.text
              : JSON.stringify(item)}
          </div>
        );
    }
  };

  return (
    <div
      id="event-log"
      ref={containerRef}
      className="event-log"
      aria-live="polite"
      role="log"
      style={{
        maxHeight: "360px",
        overflowY: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: "0.85rem",
        lineHeight: 1.45,
        padding: "0.8rem",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {events.length === 0 ? (
        <span className="text-muted">Awaiting pipeline events…</span>
      ) : (
        events.map((event, idx) => renderEventItem(event, idx))
      )}
    </div>
  );
}
