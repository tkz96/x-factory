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
import { Button } from "../components/ui/Button.js";
import type { ProviderDescriptor } from "../connection/types.js";
import { useModal } from "../context/ModalContext.js";
import { useCurrentProject } from "../context/ProjectContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useRuns, useTickets } from "../hooks/useQueries.js";
import { queryKeys } from "../lib/query-policies.js";
import { handWrittenTicketsOf, ticketRunLinkOf } from "../lib/ticket-runs.js";
import "./QueueView.css";

const EMPTY_TICKETS: Ticket[] = [];
const EMPTY_RUNS: Run[] = [];
const EMPTY_DESCRIPTORS: ProviderDescriptor[] = [];

/**
 * The label a ticket needs to appear: the tracker connection's own
 * `requiredLabel` when set, otherwise the default workflow label.
 */
function workflowLabelOf(project: Project): string {
  const tracker = project.connections?.find((c) => c.roles.includes("tracker"));
  const label = tracker?.config.requiredLabel;
  return typeof label === "string" && label.trim()
    ? label.trim()
    : CONNECTIONS_COPY.workflowLabel;
}

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
  const trackerTickets = ticketsQuery.data ?? EMPTY_TICKETS;
  // Tickets the operator wrote by hand, read from this project's runs. They can
  // only be told apart once the tracker has answered, so none are derived before.
  const handWritten = useMemo(
    () =>
      ticketsQuery.data
        ? handWrittenTicketsOf(runs, project.id, trackerTickets)
        : EMPTY_TICKETS,
    [ticketsQuery.data, runs, project.id, trackerTickets],
  );
  const handWrittenIds = useMemo(
    () => new Set(handWritten.map((t) => t.id)),
    [handWritten],
  );
  const tickets = useMemo(
    () => [...trackerTickets, ...handWritten],
    [trackerTickets, handWritten],
  );
  const filtered = useMemo(
    () => filterTickets(tickets, searchQuery),
    [tickets, searchQuery],
  );
  const searching = searchQuery.trim().length > 0;
  const headingId = `tickets-group-${project.id}`;
  // The label this tracker requires: the tag a ticket with no labels of its own
  // shows, and the name the search field's guidance carries.
  const workflowLabel = workflowLabelOf(project);

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
    <Button
      id={heading ? undefined : "btn-queue-manual"}
      variant="secondary"
      size="sm"
      icon="icon-plus"
      onPress={() => openNewRunModal({ projectId: project.id })}
    >
      {QUEUE_COPY.manualRun}
    </Button>
  );

  const list = (
    <div className="tickets-region">
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
        emptyTitle={
          searching ? QUEUE_COPY.noMatchesTitle : QUEUE_COPY.emptyTitle
        }
        emptyCopy={
          searching
            ? QUEUE_COPY.noMatches(searchQuery)
            : QUEUE_COPY.empty(workflowLabel)
        }
        emptyIcon={searching ? "icon-search" : "icon-layers"}
        emptyAction={
          searching ? (
            <Button variant="secondary" size="sm" onPress={onClearSearch}>
              {QUEUE_COPY.clearFilter}
            </Button>
          ) : (
            manualRunAction
          )
        }
      >
        {/* The list is inside the region, so the cards keep the list's own gap
            whether the region is ready, stale or partial. */}
        <div className="tickets-grid" data-list>
          {filtered.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              projectId={project.id}
              workflowLabel={workflowLabel}
              runLink={ticketRunLinkOf(runs, project.id, ticket.id)}
              handWritten={handWrittenIds.has(ticket.id)}
            />
          ))}
        </div>
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
  const isRefreshing = useIsFetching({ queryKey: queryKeys.allTickets() }) > 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTickets() });
  };

  // With no project at all there is no tracker to query: an empty workspace,
  // not a load, so say how to add one.
  const noProjects = !isProjectsLoading && projects.length === 0;
  // The toolbar names the label the search filters by: the one selected project's
  // label, or the default when the scope is every project.
  const toolbarWorkflowLabel = selectedProject
    ? workflowLabelOf(selectedProject)
    : CONNECTIONS_COPY.workflowLabel;

  const searchToolbar = (
    <TicketSearchToolbar
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      workflowLabel={toolbarWorkflowLabel}
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
        <div id="queue-tickets-list" className="tickets-region" data-list>
          <AsyncRegion
            derived={empty}
            emptyTitle={QUEUE_COPY.noProjectsTitle}
            emptyCopy={QUEUE_COPY.noProjects}
            emptyIcon="icon-folder"
            emptyAction={
              <Button
                variant="primary"
                size="sm"
                icon="icon-plus"
                onPress={openOnboardingModal}
              >
                {QUEUE_COPY.addProject}
              </Button>
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
