// src/frontend/components/projects/ProjectList.tsx — THE projects list pane
// (#267, spec #241): one row per project, the way Mail lists messages.
//
// A row is a link to the project's detail, so the list navigates and the
// browser's own link semantics (middle click, copy link, focus) keep working.
// The pane owns the Active/Archived filter and the first-run empty state, whose
// one action opens the add-project sheet (#268) through the existing modal
// context — the list never reaches into the wizard itself.

import "./ProjectList.css";

import { useState } from "react";
import type { Project } from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import { useProjects } from "../../hooks/useQueries.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import {
  CONNECTIONS_COPY,
  PROJECT_DETAIL_COPY,
  PROJECTS_COPY,
} from "../feedback/copy-map.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { ListRow } from "../ui/ListRow.js";
import { ListGroup } from "../ui/ListGroup.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { deriveConnectionIntegrity } from "./connection-integrity.js";
import { projectRepository } from "./project-facts.js";

type ProjectsFilter = "active" | "archived";

/** The badges a row carries: archived, and the integrity failure when it applies. */
function RowBadges({ project }: { project: Project }) {
  const archived = Boolean(project.archived);
  const hasIntegrityFailure =
    deriveConnectionIntegrity(project).hasIntegrityFailure;
  if (!archived && !hasIntegrityFailure) {
    return null;
  }
  return (
    <>
      {archived && <Badge>{PROJECT_DETAIL_COPY.archived}</Badge>}
      {hasIntegrityFailure && (
        <Badge tone="error">{CONNECTIONS_COPY.integrityFailure.title}</Badge>
      )}
    </>
  );
}

export interface ProjectListProps {
  /** The project the URL names, if any. */
  selectedId?: string | undefined;
}

export function ProjectList({ selectedId }: ProjectListProps) {
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const { openOnboardingModal } = useModal();
  const [filter, setFilter] = useState<ProjectsFilter>("active");

  const active = projects.filter((project) => !project.archived);
  const archived = projects.filter((project) => Boolean(project.archived));
  const visible = filter === "active" ? active : archived;

  // One read region over the projects query. "Empty" is about the filter the
  // user is looking at, which is the region in front of them.
  const derived = deriveAsyncState(projectsQuery, {
    isEmpty: (query) => query.data !== undefined && visible.length === 0,
  });

  // The empty state's guidance says what the filter left out — and only the
  // first run (no projects at all) offers Add Project.
  const emptyCopy =
    projects.length === 0
      ? PROJECTS_COPY.empty
      : filter === "active"
        ? PROJECTS_COPY.emptyActive
        : PROJECTS_COPY.emptyArchived;

  return (
    <div className="projects-list-pane">
      <div className="projects-list-header">
        <SegmentedControl
          label={PROJECTS_COPY.filterLabel}
          value={filter}
          onChange={(id) =>
            setFilter(id === "archived" ? "archived" : "active")
          }
          options={[
            { id: "active", label: PROJECTS_COPY.filterActive },
            { id: "archived", label: PROJECTS_COPY.filterArchived },
          ]}
        />
      </div>

      <AsyncRegion
        derived={derived}
        onRetry={() => void projectsQuery.refetch()}
        placeholderRows={4}
        placeholderGroup
        emptyTitle={
          projects.length === 0
            ? PROJECTS_COPY.emptyTitle
            : filter === "active"
              ? PROJECTS_COPY.emptyActiveTitle
              : PROJECTS_COPY.emptyArchivedTitle
        }
        emptyCopy={emptyCopy}
        emptyIcon="icon-folder"
        emptyAction={
          projects.length === 0 ? (
            <Button
              variant="primary"
              size="sm"
              icon="icon-plus"
              onPress={openOnboardingModal}
            >
              {PROJECTS_COPY.addProject}
            </Button>
          ) : undefined
        }
      >
        {/* One inset group: the rows share hairlines, and each row is the
            shared list row — 44pt tall, title left, accessory trailing. */}
        <ListGroup>
          {visible.map((project) => (
            <li key={project.id}>
              <ListRow
                href={`/projects/${project.id}`}
                isCurrent={project.id === selectedId}
                className="projects-list-row"
                leadingIcon="icon-folder"
                title={project.name}
                subtitle={projectRepository(project).value}
                trailing={<RowBadges project={project} />}
                accessibleLabel={PROJECTS_COPY.openProject(project.name)}
              />
            </li>
          ))}
        </ListGroup>
      </AsyncRegion>
    </div>
  );
}
