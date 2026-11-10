// src/frontend/views/ProjectDetailView.tsx — One project in the detail pane of
// the Projects split (#267, spec #241; XFM-48, rebuilt on the feedback family
// in #147).
//
// The pane is three tabs — General, Connection, Repositories — chosen with a
// segmented control and kept in the URL (?tab=…&repo=…). The readiness banner
// stays above them: it applies to every tab. The Repositories tab shows one
// repository's form at a time. The read region (loading / error / not-found) renders through
// AsyncRegion and the copy map, beside the list.

import "./ProjectDetailView.css";

import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { ProjectGitIdentity } from "../components/projects/ProjectGitIdentity.js";
import { ProjectsSplit } from "../components/projects/ProjectsSplit.js";
import { projectFacts } from "../components/projects/project-facts.js";
import { ReadinessBanner } from "../components/projects/ReadinessBanner.js";
import { RepositoriesPanel } from "../components/projects/RepositoriesPanel.js";
import { TrackerSection } from "../components/projects/TrackerSection.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { SegmentedControl } from "../components/ui/SegmentedControl.js";
import { usePageHeader } from "../context/PageHeaderContext.js";
import { useConnectionLine } from "../hooks/useConnectionIdentity.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useProjects } from "../hooks/useQueries.js";

type ProjectTab = "general" | "connection" | "repositories";
const TABS: readonly ProjectTab[] = ["general", "connection", "repositories"];

function parseTab(value: string | null): ProjectTab {
  return TABS.find((tab) => tab === value) ?? "general";
}

export function ProjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const tab = parseTab(searchParams.get("tab"));
  const selectedRepoId = searchParams.get("repo") ?? undefined;

  // The tab and the repository are the URL's: a reload or a shared link keeps
  // them. Changing a tab replaces the entry, so Back leaves the project.
  const chooseTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === "general") params.delete("tab");
    else params.set("tab", next);
    if (next !== "repositories") params.delete("repo");
    setSearchParams(params, { replace: true });
  };
  const chooseRepo = (repoId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", "repositories");
    params.set("repo", repoId);
    setSearchParams(params, { replace: true });
  };

  // The subtitle: the tracker's provider and what it tracks — the provider's own
  // name for the connection ("xynotech/Converso") when it describes one, else
  // the repository the project works in.
  const [repositoryFact, trackerFact] = facts;
  const trackerIdentity = slots.find(
    (slot) => slot.role === "tracker",
  )?.identity;
  const subtitle = [
    trackerFact?.value,
    trackerIdentity ?? repositoryFact?.value,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <ProjectsSplit selectedId={project.id}>
      <article className="projects-detail">
        <div className="projects-detail-header">
          <div className="projects-detail-heading">
            <p className="projects-detail-subtitle text-callout">{subtitle}</p>
            {project.archived && (
              <div className="projects-detail-status">
                <Badge>{PROJECT_DETAIL_COPY.archived}</Badge>
              </div>
            )}
          </div>
          <SegmentedControl
            label={PROJECT_DETAIL_COPY.tabsLabel}
            value={tab}
            onChange={chooseTab}
            collapseBelow="(max-width: 768px)"
            options={[
              { id: "general", label: PROJECT_DETAIL_COPY.tabGeneral },
              { id: "connection", label: PROJECT_DETAIL_COPY.tabConnection },
              {
                id: "repositories",
                label: PROJECT_DETAIL_COPY.tabRepositories,
                count: repos.length,
              },
            ]}
          />
        </div>

        <ReadinessBanner />

        {tab === "general" && (
          <section className="projects-detail-panel">
            <Card padding="regular">
              <h3 className="text-headline">
                {PROJECT_DETAIL_COPY.generalTitle}
              </h3>
              <dl className="projects-detail-facts">
                <div className="projects-detail-fact">
                  <dt className="text-subhead">
                    {PROJECT_DETAIL_COPY.projectName}
                  </dt>
                  <dd className="projects-detail-fact-value text-body">
                    {project.name}
                  </dd>
                </div>
                <div className="projects-detail-fact">
                  <dt className="text-subhead">
                    {PROJECT_DETAIL_COPY.projectId}
                  </dt>
                  <dd className="projects-detail-fact-value projects-detail-fact-value--path text-body">
                    {project.id}
                  </dd>
                </div>
              </dl>
            </Card>
            <ProjectGitIdentity
              key={project.id}
              projectId={project.id}
              gitIdentity={project.gitIdentity}
            />
          </section>
        )}

        {tab === "connection" && (
          <section className="projects-detail-panel">
            <ConnectionComboLine
              id="project-connections-combo"
              slots={slots}
              tone={comboTone(slots, REQUIRED_POST_CREATION_ROLES)}
              descriptors={descriptors}
              size="subhead"
            />
            <TrackerSection project={project} />
          </section>
        )}

        {tab === "repositories" && (
          <RepositoriesPanel
            projectId={project.id}
            repositories={repos}
            selectedId={selectedRepoId}
            onSelect={chooseRepo}
          />
        )}
      </article>
    </ProjectsSplit>
  );
}
