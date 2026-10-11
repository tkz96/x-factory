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
import { Link } from "react-router-dom";
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
    <span className="projects-list-row-badges">
      {archived && <Badge>{PROJECT_DETAIL_COPY.archived}</Badge>}
      {hasIntegrityFailure && (
        <Badge tone="error">{CONNECTIONS_COPY.integrityFailure.title}</Badge>
      )}
    </span>
  );
}

interface ProjectListRowProps {
  project: Project;
  /** The project the URL names, if any: the row reads as the current one. */
  isSelected: boolean;
}

/** One project row. The whole row is the link, and nothing sits inside it. */
function ProjectListRow({ project, isSelected }: ProjectListRowProps) {
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="projects-list-row"
        data-list-row
        aria-label={PROJECTS_COPY.openProject(project.name)}
        aria-current={isSelected ? "page" : undefined}
      >
        <svg className="icon icon-md" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-folder" />
        </svg>
        <span className="projects-list-row-main">
          <span className="projects-list-row-title">{project.name}</span>
          <span className="projects-list-row-subtitle">
            {projectRepository(project).value}
          </span>
        </span>
        <RowBadges project={project} />
      </Link>
    </li>
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
        emptyCopy={emptyCopy}
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
        <ul className="projects-list" data-list>
          {visible.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              isSelected={project.id === selectedId}
            />
          ))}
        </ul>
      </AsyncRegion>
    </div>
  );
}
