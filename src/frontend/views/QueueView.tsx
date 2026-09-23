// src/frontend/views/QueueView.tsx — Work queue view with ticket search & launch actions (XFM-38, XFM-40, XFM-47).

import { useMemo, useState } from "react";
import { TicketCard } from "../components/queue/TicketCard.js";
import { TicketSearchToolbar } from "../components/queue/TicketSearchToolbar.js";
import { useModal } from "../context/ModalContext.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useTickets } from "../hooks/useQueries.js";
import "./QueueView.css";

export function QueueView() {
  const { selectedProjectId } = useCurrentProject();
  const { openNewRunModal } = useModal();
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: tickets = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useTickets(selectedProjectId);

  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return tickets;
    const q = searchQuery.toLowerCase().trim();
    return tickets.filter((t) => {
      const matchId = t.id.toLowerCase().includes(q);
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchCriteria = (t.acceptanceCriteria || []).some((c) =>
        c.toLowerCase().includes(q),
      );
      return matchId || matchTitle || matchCriteria;
    });
  }, [tickets, searchQuery]);

  return (
    <section id="area-queue" className="area-view active">
      <TicketSearchToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
      />

      <div id="queue-tickets-list" className="tickets-grid">
        {isLoading ? (
          <div className="empty-state card">
            <div className="spinner-sm" />
            <h3 className="mt-4">Loading Work Queue…</h3>
            <p className="text-muted">
              Fetching tickets from connected issue tracker.
            </p>
          </div>
        ) : error ? (
          <div className="empty-state card">
            <div className="empty-icon">
              <svg className="icon icon-xl" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-alert-circle" />
              </svg>
            </div>
            <h3>Unable to Load Work Queue</h3>
            <p className="error-message queue-error-message">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <button
              type="button"
              id="btn-queue-manual"
              className="btn-secondary btn-sm mt-4"
              onClick={() => openNewRunModal()}
            >
              Start Manual Run
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-icon">
              <svg className="icon icon-xl" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-calendar" />
              </svg>
            </div>
            <h3>No Issue Tracker Connected</h3>
            <p>
              Configure GitHub, Jira, or Azure DevOps in Settings to pull
              tickets with the <code>agentic-workflow</code> label
              automatically.
            </p>
            <button
              type="button"
              id="btn-queue-manual"
              className="btn-secondary btn-sm mt-4"
              onClick={() => openNewRunModal()}
            >
              Start Manual Run
            </button>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-icon">
              <svg className="icon icon-xl" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-search" />
              </svg>
            </div>
            <h3>No Matching Tickets</h3>
            <p className="text-muted">
              No tickets matched your search query &ldquo;{searchQuery}&rdquo;.
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm mt-4"
              onClick={() => setSearchQuery("")}
            >
              Clear Filter
            </button>
          </div>
        ) : (
          filteredTickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))
        )}
      </div>
    </section>
  );
}
