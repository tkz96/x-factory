// src/frontend/lib/project-scope.ts — The one project scope shared by Tickets
// and Runs (#260, spec #241).
//
// The scope is either ALL_PROJECTS or a project id. The choice is remembered per
// browser under the same key the app always used. Browser storage can be blocked
// or throw, so every read and write is guarded: a blocked store means the default
// scope applies and the choice is simply not remembered.

import type { Project, Run } from "../../shared/types.js";

/** The scope value for "All Projects", the first-launch default. */
export const ALL_PROJECTS = "all" as const;

/** The storage key the scope is remembered under (unchanged since XFM-46). */
export const PROJECT_SCOPE_STORAGE_KEY = "xf_selected_project";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Accessing the store itself can throw in a locked-down browser.
    return null;
  }
}

/** The scope the viewer chose last, or ALL_PROJECTS when none is remembered. */
export function readStoredProjectScope(): string {
  try {
    const stored = storage()?.getItem(PROJECT_SCOPE_STORAGE_KEY);
    return stored ? stored : ALL_PROJECTS;
  } catch {
    return ALL_PROJECTS;
  }
}

/** Remembers the scope. A blocked store is not an error for the user. */
export function writeStoredProjectScope(scope: string): void {
  try {
    storage()?.setItem(PROJECT_SCOPE_STORAGE_KEY, scope);
  } catch {
    // The choice simply is not remembered.
  }
}

/**
 * Turns the remembered scope into one that exists. A project that was removed,
 * or an unknown value, falls back to All Projects. Until the projects load (or
 * when there are none to check against) the remembered value is kept, so a
 * refresh does not flicker to All Projects.
 */
export function resolveProjectScope(
  scope: string,
  projects: readonly Pick<Project, "id">[],
  projectsLoaded: boolean,
): string {
  if (scope === ALL_PROJECTS) return ALL_PROJECTS;
  // Nothing to check the choice against yet, or no projects at all.
  if (!projectsLoaded || projects.length === 0) return scope;
  return projects.some((p) => p.id === scope) ? scope : ALL_PROJECTS;
}

/** The runs the shared scope shows: all of them, or those of the scoped project. */
export function runsInScope<T extends Pick<Run, "project">>(
  runs: readonly T[],
  scope: string,
): T[] {
  if (scope === ALL_PROJECTS) return [...runs];
  return runs.filter((run) => run.project?.id === scope);
}
