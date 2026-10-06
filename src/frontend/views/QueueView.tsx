// src/frontend/views/QueueView.tsx — Work queue view (XFM-38, XFM-40, XFM-47;
// rebuilt on the feedback family in #147).
//
// The queue is a read region over the tickets query, and it is gated by the
// selected project's connection integrity: a project with no tracker is an
// integrity failure with a repair path, NEVER a successfully-empty queue
// (spec #133 story 49). A degraded tracker keeps the queue visible with a
// warning, and a real query error keeps the manual path open.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Ticket } from "../../shared/types.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import {
  CONNECTIONS_COPY,
  QUEUE_COPY,
} from "../components/feedback/copy-map.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import { formatConnectionWarnings } from "../components/projects/connection-copy.js";
import {
  applyConnectionIntegrity,
  deriveConnectionIntegrity,
} from "../components/projects/connection-integrity.js";
import { TicketCard } from "../components/queue/TicketCard.js";
import { TicketSearchToolbar } from "../components/queue/TicketSearchToolbar.js";
import { useModal } from "../context/ModalContext.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useTickets } from "../hooks/useQueries.js";
import "./QueueView.css";

const EMPTY_TICKETS: Ticket[] = [];

export function QueueView() {
  const { selectedProjectId, selectedProject } = useCurrentProject();
  const { openNewRunModal } = useModal();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: descriptors = [] } = useProviderDescriptors();

  const ticketsQuery = useTickets(selectedProjectId);
  const tickets = ticketsQuery.data ?? EMPTY_TICKETS;
  const { isRefetching, refetch } = ticketsQuery;

  const integrity = selectedProject
    ? deriveConnectionIntegrity(selectedProject, descriptors)
    : undefined;

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

  const searching = searchQuery.trim().length > 0;

  // The integrity failure is primary over every async condition: the queue
  // cannot be loaded at all, so it must never read as a successfully-empty
  // queue. Precedence still carries the asynchronous diagnostics.
  const derived = applyConnectionIntegrity(
    deriveAsyncState(ticketsQuery, {
      isEmpty: (query) =>
        Array.isArray(query.data) &&
        (searching ? filteredTickets.length === 0 : tickets.length === 0),
    }),
    integrity,
  );

  const manualRunAction = (
    <button
      type="button"
      id="btn-queue-manual"
      className="btn-secondary btn-sm"
      onClick={() => openNewRunModal()}
    >
      {QUEUE_COPY.manualRun}
    </button>
  );

  const integrityFailure = integrity?.hasIntegrityFailure === true;
  const showManualRun = integrityFailure || derived.state === "error";

  return (
    <section id="area-queue" className="area-view active">
      <TicketSearchToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
      />

      <div id="queue-tickets-list" className="tickets-grid">
        <AsyncRegion
          derived={derived}
          onRetry={
            integrityFailure ? () => navigate("/settings") : () => refetch()
          }
          errorCopy={
            integrityFailure
              ? CONNECTIONS_COPY.integrityFailure.message
              : undefined
          }
          retryLabel={integrityFailure ? CONNECTIONS_COPY.reconnect : undefined}
          emptyCopy={
            searching ? QUEUE_COPY.noMatches(searchQuery) : QUEUE_COPY.empty
          }
          emptyAction={
            searching ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSearchQuery("")}
              >
                {QUEUE_COPY.clearFilter}
              </button>
            ) : (
              manualRunAction
            )
          }
        >
          {filteredTickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </AsyncRegion>

        {integrity?.tracker.state === "degraded" && (
          <FeedbackBanner
            tone="warning"
            message={CONNECTIONS_COPY.degradedTitle}
            items={formatConnectionWarnings(integrity.tracker.warnings)}
          />
        )}

        {showManualRun && (
          <div className="queue-manual-actions">{manualRunAction}</div>
        )}
      </div>
    </section>
  );
}
