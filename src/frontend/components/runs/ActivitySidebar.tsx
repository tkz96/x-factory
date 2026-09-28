// src/frontend/components/runs/ActivitySidebar.tsx — Compact activity log sidebar showing pipeline events.

import "./ActivitySidebar.css";

import { useEffect, useRef } from "react";
import type { CanonicalWireEvent } from "../../hooks/useRunSSE.js";
import { ChatThread } from "./ChatThread.js";

interface ActivitySidebarProps {
  events: CanonicalWireEvent[];
  connected: boolean;
}

export function ActivitySidebar({ events, connected }: ActivitySidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <aside className="activity-sidebar" id="activity-sidebar">
      <div className="activity-sidebar-header">
        <h4>
          Activity Log
          {connected && (
            <span
              className="status-dot status-dot-sm online activity-dot"
              title="Live SSE stream connected"
            />
          )}
        </h4>
        <span className="activity-count">{events.length}</span>
      </div>
      <div className="activity-sidebar-scroll" ref={scrollRef}>
        <ChatThread events={events} />
      </div>
    </aside>
  );
}
