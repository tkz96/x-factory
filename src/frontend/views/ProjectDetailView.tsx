// src/frontend/views/ProjectDetailView.tsx — One project in the detail pane of
// the Projects split (#267, spec #241; XFM-48, rebuilt on the feedback family
// in #147).
//
// The pane answers the three plain-word questions first — which repository,
// which tracker, which branch (spec story 108) — and then shows the surfaces
// that act on the project: the wiring line, readiness, the tracker card and the
// repositories. The read region (loading / error / not-found) renders through
// AsyncRegion and the copy map, beside the list.

import "./ProjectDetailView.css";

import { useNavigate, useParams } from "react-router-dom";
import { ConnectionComboLine } from "../components/connections/ConnectionComboLine.js";
import { comboTone } from "../components/connections/connection-state.js";
import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { PROJECT_DETAIL_COPY } from "../components/feedback/copy-map.js";
import { deriveAsyncState } from "../components/feedback/derive-async-state.js";
import {
  comboSlots,
  deriveConnectionIntegrity,
  REQUIRED_POST_CREATION_ROLES,
  recordedConnectionIdentityTargets,
} from "../components/projects/connection-integrity.js";
import { ProjectsSplit } from "../components/projects/ProjectsSplit.js";
import { projectFacts } from "../components/projects/project-facts.js";
import { ReadinessBanner } from "../components/projects/ReadinessBanner.js";
import { RepositorySettings } from "../components/projects/RepositorySettings.js";
import { TrackerSection } from "../components/projects/TrackerSection.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Table, TableCell, TableRow } from "../components/ui/Table.js";
import { usePageHeader } from "../context/PageHeaderContext.js";
import { useConnectionLine } from "../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useProjects } from "../hooks/useQueries.js";

export function ProjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectsQuery = useProjects();
  const { data: descriptors = [] } = useProviderDescriptors();

  const projects = projectsQuery.data ?? [];
  const project = projects.find((p) => p.id === id);

  // One read region over the projects query: loading until it resolves, a
  // retryable error if it fails, and the not-found empty state once the
  // catalog has loaded without this id.
  const derived = deriveAsyncState(projectsQuery, {
    isEmpty: () => projectsQuery.data !== undefined && project === undefined,
  });

  const backToProjects = () => navigate("/projects");

  // The identity wiring for the project this view resolved — no slots while the
  // read has not resolved to one. It happens BEFORE the not-found return because
  // it is a hook: hooks run in the same order on every render (#133 story 34),
  // and the derived integrity is pure, so computing it here for the line the
  // render below may not reach costs nothing.
  const integrity =
    project === undefined
      ? undefined
      : deriveConnectionIntegrity(project, descriptors);
  const slots = useConnectionLine(
    integrity === undefined ? [] : comboSlots(integrity),
    integrity === undefined
      ? []
      : recordedConnectionIdentityTargets(integrity, undefined, descriptors),
  );

  // The shell's page heading names the project (#298): the view claims it here,
  // so the title travels with the data. The view renders no heading of its own.
  usePageHeader({ title: project?.name ?? "Project" });

  if (project === undefined || integrity === undefined) {
    return (
      <ProjectsSplit selectedId={id}>
        <AsyncRegion
          derived={derived}
          onRetry={() => void projectsQuery.refetch()}
          emptyCopy={PROJECT_DETAIL_COPY.notFound(id ?? "")}
          emptyAction={
            <Button variant="secondary" size="sm" onPress={backToProjects}>
              ← {PROJECT_DETAIL_COPY.backToProjects}
            </Button>
          }
        />
      </ProjectsSplit>
    );
  }

  const facts = projectFacts(project, descriptors);
  const repos = project.repositories || [];

  return (
    <ProjectsSplit selectedId={project.id}>
      <article className="projects-detail">
        {/* No second title: the page heading above the split names the
            project, so this pane starts with what the project is wired to. */}
        {project.archived && (
          <div className="projects-detail-status">
            <Badge>{PROJECT_DETAIL_COPY.archived}</Badge>
          </div>
        )}

        {/* The three plain-word facts in one card: a glance answers what this
            project is wired to. */}
        <Card className="projects-detail-facts-panel" padding="regular">
          <dl className="projects-detail-facts">
            {facts.map((fact) => (
              <div className="projects-detail-fact" key={fact.label}>
                <dt className="text-subhead">{fact.label}</dt>
                <dd
                  className={
                    fact.isPath
                      ? "projects-detail-fact-value text-callout projects-detail-fact-value--path"
                      : "projects-detail-fact-value text-subhead"
                  }
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <p className="projects-detail-id text-footnote">
          <span>{PROJECT_DETAIL_COPY.projectId}</span>
          <code>{project.id}</code>
        </p>

        <ConnectionComboLine
          id="project-connections-combo"
          slots={slots}
          tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
          descriptors={descriptors}
        />

        <ReadinessBanner />

        <div className="mt-6">
          <TrackerSection project={project} />
        </div>

        <div className="project-repos-section mt-6">
          <div className="section-header-flex mb-3">
            <h3 className="text-headline">{PROJECT_DETAIL_COPY.repositories}</h3>
            <Badge id="project-detail-repo-count">{repos.length}</Badge>
          </div>

          {/* One table style app-wide (the Table block): an inset group with
              hairlines between rows, which re-flows into stacked rows on a
              phone instead of scrolling sideways. */}
          <div id="project-detail-repos-table">
            {repos.length === 0 ? (
              <EmptyState
                icon="icon-folder"
                message={PROJECT_DETAIL_COPY.repositoriesEmpty}
              />
            ) : (
              <Table
                label={PROJECT_DETAIL_COPY.repositories}
                columns={[
                  {
                    id: "name",
                    label: PROJECT_DETAIL_COPY.repositoryNameColumn,
                  },
                  {
                    id: "path",
                    label: PROJECT_DETAIL_COPY.repositoryPathColumn,
                  },
                  {
                    id: "branch",
                    label: PROJECT_DETAIL_COPY.repositoryBranchColumn,
                  },
                ]}
              >
                {repos.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell isRowHeader>{r.name}</TableCell>
                    <TableCell
                      label={PROJECT_DETAIL_COPY.repositoryPathColumn}
                      className="repo-path-cell"
                    >
                      <span className="repo-path text-callout" title={r.path}>
                        {r.path}
                      </span>
                    </TableCell>
                    <TableCell
                      label={PROJECT_DETAIL_COPY.repositoryBranchColumn}
                      className="repo-branch-cell text-callout"
                    >
                      {r.defaultBranch ||
                        PROJECT_DETAIL_COPY.defaultBranchFallback}
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            )}
          </div>
        </div>

        {repos.length > 0 && (
          <div className="mt-6">
            <RepositorySettings projectId={project.id} repositories={repos} />
          </div>
        )}
      </article>
    </ProjectsSplit>
  );
}
