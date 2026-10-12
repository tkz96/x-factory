// src/frontend/components/projects/project-facts.ts — The plain-word facts a
// project shows (#267, spec #241 story 108): repository, tracker, branch.
//
// Pure: the same project and providers manifest always produce the same facts,
// so the wording is tested as a table of input → output. Provider names come
// from the manifest (`resolveProviderLabel`), never from an id→name table, and
// the tracker's state comes from the one connection view — a project whose
// tracker is not connected says so in the same words every other surface uses.

import type { Project } from "../../../shared/types.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import {
  CONNECTIONS_COPY,
  PROJECT_DETAIL_COPY,
  PROJECTS_COPY,
} from "../feedback/copy-map.js";
import {
  deriveConnectionIntegrity,
  resolveProviderLabel,
} from "./connection-integrity.js";

/** One fact as the detail pane renders it. */
export interface ProjectFact {
  /** The plain-word label: Repository, Tracker, Branch. */
  readonly label: string;
  readonly value: string;
  /** A recorded path or folder, rendered in the monospace face. */
  readonly isPath: boolean;
}

/** The repository a project works in: its primary repository, or its checkout. */
export interface ProjectRepositoryValue {
  readonly value: string;
  readonly isPath: boolean;
}

/**
 * `owner/repository` from a remote URL (G3): a project row names the
 * repository, not the whole URL. A remote that names no repository — a bare
 * folder, say — is shown exactly as it was recorded.
 */
function ownerRepoFromRemote(remote: string): string {
  const match = /[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match?.[1] ?? remote.trim();
}

/**
 * The repository in plain words: the primary repository's name, with the
 * `owner/repository` its remote names when one is recorded, or the folder the
 * project is checked out in. Answers "Not recorded" only when the project
 * records neither.
 */
export function projectRepository(project: Project): ProjectRepositoryValue {
  const primary = (project.repositories ?? [])[0];
  if (primary !== undefined) {
    const remote = primary.remote?.trim() ?? "";
    return {
      value:
        remote === ""
          ? primary.name
          : `${primary.name} — ${ownerRepoFromRemote(remote)}`,
      isPath: false,
    };
  }
  const folder =
    project.workspacePath?.trim() || project.repositoryPath?.trim() || "";
  return folder === ""
    ? { value: PROJECTS_COPY.noRepository, isPath: false }
    : { value: folder, isPath: true };
}

/**
 * The detail pane's facts, in reading order: what the project works in, which
 * tracker feeds its tickets, and the branch runs start from.
 */
export function projectFacts(
  project: Project,
  descriptors: readonly ProviderDescriptor[] = [],
): ProjectFact[] {
  const repository = projectRepository(project);
  const tracker = deriveConnectionIntegrity(project, descriptors).tracker;

  return [
    {
      label: PROJECTS_COPY.repositoryFact,
      value: repository.value,
      isPath: repository.isPath,
    },
    {
      label: PROJECTS_COPY.trackerFact,
      value:
        tracker.providerId === undefined
          ? CONNECTIONS_COPY.stateLabel.disconnected
          : resolveProviderLabel(tracker.providerId, descriptors),
      isPath: false,
    },
    {
      label: PROJECTS_COPY.branchFact,
      value: project.defaultBranch?.trim()
        ? project.defaultBranch.trim()
        : PROJECT_DETAIL_COPY.defaultBranchFallback,
      isPath: false,
    },
  ];
}
