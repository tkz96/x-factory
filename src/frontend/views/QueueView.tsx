// src/frontend/views/QueueView.tsx — The Tickets section (XFM-38, XFM-40,
// XFM-47; rebuilt on the feedback family in #147; project scope in #260).
//
// The shared project scope picks what this list shows. A single project is one
// tickets region. "All Projects" is one region per project, each loading, empty
// and failing on its own. A project with no tracker is an integrity failure with
// a repair path, NEVER a successfully-empty list (spec #133 story 49). A degraded
// tracker keeps the list visible with a warning, and a real query error keeps
// the manual path open.

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project, Run, Ticket } from "../../shared/types.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import {
  CONNECTIONS_COPY,
  QUEUE_COPY,
} from "../components/feedback/copy-map.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import { FeedbackBanner } from "../components/feedback/FeedbackBanner.js";
import type { DerivedAsyncState } from "../components/feedback/types.js";
import { formatConnectionWarnings } from "../components/projects/connection-copy.js";
import {
  applyConnectionIntegrity,
  deriveConnectionIntegrity,
} from "../components/projects/connection-integrity.js";
import { TicketCard } from "../components/queue/TicketCard.js";
import { TicketSearchToolbar } from "../components/queue/TicketSearchToolbar.js";
import type { ProviderDescriptor } from "../connection/types.js";
import { useModal } from "../context/ModalContext.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useRuns, useTickets } from "../hooks/useQueries.js";
import { ticketRunLinkOf } from "../lib/ticket-runs.js";
import "./QueueView.css";

const EMPTY_TICKETS: Ticket[] = [];
const EMPTY_RUNS: Run[] = [];
const EMPTY_DESCRIPTORS: ProviderDescriptor[] = [];

function filterTickets(tickets: readonly Ticket[], searchQuery: string) {
  const q = searchQuery.toLowerCase().trim();
  if (!q) return tickets;
  return tickets.filter(
    (t) =>
      t.id.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q) ||
      (t.acceptanceCriteria || []).some((c) => c.toLowerCase().includes(q)),
  );
}

interface ProjectTicketsProps {
  project: Project;
  searchQuery: string;
  runs: readonly Run[];
  onClearSearch: () => void;
  descriptors: readonly ProviderDescriptor[];
  /** Group mode names the project above its own list (#260). */
  heading?: boolean;
}

/**
 * One project's tracker: its own query, its own states, its own Retry. Each
 * project in All Projects mode renders one of these, so none waits on another.
 */
function ProjectTickets({
  project,
  searchQuery,
  runs,
  onClearSearch,
  descriptors,
  heading = false,
}: ProjectTicketsProps) {
  const { openNewRunModal } = useModal();
  const navigate = useNavigate();
  const ticketsQuery = useTickets(project.id);
  const tickets = ticketsQuery.data ?? EMPTY_TICKETS;
  const filtered = useMemo(
    () => filterTickets(tickets, searchQuery),
    [tickets, searchQuery],
  );
  const searching = searchQuery.trim().length > 0;
  const headingId = `tickets-group-${project.id}`;

  const integrity = deriveConnectionIntegrity(project, descriptors);
  // The integrity failure is primary over every async condition: the list
  // cannot be loaded at all, so it must never read as successfully empty.
  const derived = applyConnectionIntegrity(
    deriveAsyncState(ticketsQuery, {
      isEmpty: (query) =>
        Array.isArray(query.data) &&
        (searching ? filtered.length === 0 : tickets.length === 0),
    }),
    integrity,
  );
  const integrityFailure = integrity.hasIntegrityFailure;
  const showManualRun = integrityFailure || derived.state === "error";

  const manualRunAction = (
    <button
      type="button"
      id={heading ? undefined : "btn-queue-manual"}
      className="btn-secondary btn-sm"
      onClick={() => openNewRunModal({ projectId: project.id })}
    >
      <svg className="icon icon-sm" aria-hidden="true">
        <use href="/assets/icons/sprite.svg#icon-plus" />
      </svg>
      <span>{QUEUE_COPY.manualRun}</span>
    </button>
  );

  const list = (
    <div className="tickets-grid" data-list>
      <AsyncRegion
        derived={derived}
        onRetry={
          integrityFailure
            ? () => navigate("/settings")
            : () => ticketsQuery.refetch()
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
              onClick={onClearSearch}
            >
              {QUEUE_COPY.clearFilter}
            </button>
          ) : (
            manualRunAction
          )
        }
      >
        {filtered.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            projectId={project.id}
            runLink={ticketRunLinkOf(runs, project.id, ticket.id)}
          />
        ))}
      </AsyncRegion>

      {integrity.tracker.state === "degraded" && (
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
  );

  if (!heading) return list;
  return (
    <section className="ticket-group" aria-labelledby={headingId}>
      <h2 id={headingId} className="ticket-group-title">
        {project.name}
      </h2>
      {list}
    </section>
  );
}

export function QueueView() {
  const { projects, isProjectsLoading, isAllProjects, selectedProject } =
    useCurrentProject();
  const { openOnboardingModal } = useModal();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const descriptorsQuery = useProviderDescriptors();
  const descriptors = descriptorsQuery.data ?? EMPTY_DESCRIPTORS;
  const runs = useRuns().data ?? EMPTY_RUNS;
  const isRefreshing = useIsFetching({ queryKey: ["tickets"] }) > 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  // With no project at all there is no tracker to query: an empty workspace,
  // not a load, so say how to add one.
  const noProjects = !isProjectsLoading && projects.length === 0;

  const searchToolbar = (
    <TicketSearchToolbar
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
    />
  );

  if (noProjects) {
    const empty: DerivedAsyncState = deriveAsyncState(
      { data: [], isPending: false, isError: false, error: null },
      { isEmpty: () => true },
    );
    return (
      <section id="area-queue" className="area-view active">
        {searchToolbar}
        <div id="queue-tickets-list" className="tickets-grid" data-list>
          <AsyncRegion
            derived={empty}
            emptyCopy={QUEUE_COPY.noProjects}
            emptyAction={
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={openOnboardingModal}
              >
                <svg className="icon icon-sm" aria-hidden="true">
                  <use href="/assets/icons/sprite.svg#icon-plus" />
                </svg>
                <span>{QUEUE_COPY.addProject}</span>
              </button>
            }
          />
        </div>
      </section>
    );
  }

  return (
    <section id="area-queue" className="area-view active">
      {searchToolbar}

      <div id="queue-tickets-list" className="ticket-groups">
        {isAllProjects ? (
          isProjectsLoading ? (
            <AsyncRegion
              derived={deriveAsyncState({
                data: undefined,
                isPending: true,
                isError: false,
                error: null,
              })}
            />
          ) : (
            projects.map((project) => (
              <ProjectTickets
                key={project.id}
                project={project}
                searchQuery={searchQuery}
                runs={runs}
                onClearSearch={() => setSearchQuery("")}
                descriptors={descriptors}
                heading
              />
            ))
          )
        ) : (
          selectedProject && (
            <ProjectTickets
              project={selectedProject}
              searchQuery={searchQuery}
              runs={runs}
              onClearSearch={() => setSearchQuery("")}
              descriptors={descriptors}
            />
          )
        )}
      </div>
    </section>
  );
}
