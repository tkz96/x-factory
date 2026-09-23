// src/frontend/components/queue/TicketSearchToolbar.tsx — Filter & Search controls for Work Queue (XFM-47).

import "./TicketSearchToolbar.css";

interface TicketSearchToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function TicketSearchToolbar({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
}: TicketSearchToolbarProps) {
  return (
    <div className="queue-toolbar">
      <div className="search-box">
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-search" />
        </svg>
        <input
          type="text"
          id="queue-search"
          placeholder="Filter tickets (label: agentic-workflow)…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="filter-pill">
        <span className="pill-dot" />
        <span>agentic-workflow</span>
      </div>

      <button
        type="button"
        id="btn-queue-refresh"
        className="btn-secondary btn-sm"
        title="Refresh work queue"
        aria-label="Refresh work queue"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <svg
          className={`icon icon-sm ${isRefreshing ? "spin" : ""}`}
          aria-hidden="true"
        >
          <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
        </svg>
        <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
      </button>
    </div>
  );
}
