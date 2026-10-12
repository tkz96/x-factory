// src/frontend/components/queue/TicketSearchToolbar.tsx — Filter & Search controls for Work Queue (XFM-47).
//
// The label the search filters by is a fact about the connection, not a control:
// it reads inside the field's own placeholder (A4), so nothing here looks like a
// toggle that is not one.

import { Button } from "../ui/Button.js";
import "./TicketSearchToolbar.css";

interface TicketSearchToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** The tracker's required workflow label, named in the field's guidance. */
  workflowLabel: string;
}

export function TicketSearchToolbar({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
  workflowLabel,
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
          placeholder={`Filter tickets (label: ${workflowLabel})…`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <Button
        id="btn-queue-refresh"
        variant="secondary"
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
