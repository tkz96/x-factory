// src/frontend/components/queue/TicketSearchToolbar.tsx — Filter & Search controls for Work Queue (XFM-47).

import { Button } from "../ui/Button.js";
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
          data-search-input
          aria-label="Filter tickets"
          placeholder="Filter tickets (label: agentic-workflow)…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="filter-pill">
        <span className="pill-dot" />
        <span>agentic-workflow</span>
      </div>

      <Button
        id="btn-queue-refresh"
        variant="secondary"
        size="sm"
        aria-label="Refresh tickets"
        isDisabled={isRefreshing}
        onPress={onRefresh}
      >
        <svg
          className={`icon icon-sm ${isRefreshing ? "icon-spin" : ""}`}
          aria-hidden="true"
        >
          <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
        </svg>
        <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
      </Button>
    </div>
  );
}
