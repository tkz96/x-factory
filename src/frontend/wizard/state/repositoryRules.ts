// src/frontend/wizard/state/repositoryRules.ts — Pure derived rules for the
// Repositories step (spec #133, ticket #144).
//
// Decided in #126: step validity, the application-repository requirement, and
// selection staleness are DERIVED at render time from the reducer's plain
// source state — never stored, never synced in an effect. Both the step's
// `canAdvance` and the reducer's `NEXT_STEP` guard read these same functions,
// so the UI hint and the state machine can never disagree.

import { connectionConfigFingerprint } from "../../lib/connection-fingerprint.js";
import type { WizardRepoConfig, WizardSourceState } from "../types.js";

/**
 * The connection role that makes a listed repository an application
 * repository — a code repository the workflow can run in, as opposed to a
 * repository listed only in some other role.
 */
export const APPLICATION_REPOSITORY_ROLE = "gitHost";

/** The role tags recorded for one selected repository, newest form first. */
function roleTags(config: WizardRepoConfig): readonly string[] {
  if (config.roles !== undefined && config.roles.length > 0) {
    return config.roles;
  }
  return config.role ? [config.role] : [];
}

/** True when a selected repository is usable as an application repository. */
export function isApplicationRepository(
  config: WizardRepoConfig | undefined,
): boolean {
  return (
    config !== undefined &&
    roleTags(config).includes(APPLICATION_REPOSITORY_ROLE)
  );
}

/**
 * The step-3 requirement: at least one application repository is selected.
 * A selection with no recorded role tags is not an application repository.
 */
export function hasApplicationRepository(state: WizardSourceState): boolean {
  return state.repositories.selectedRepoIds.some((id) =>
    isApplicationRepository(state.repositories.repoConfigs[id]),
  );
}

/**
 * The git-host connection fingerprint discovery and selection must belong to.
 * Follows the connection's provider id and every config value, so editing
 * either one moves the fingerprint.
 */
export function gitHostDiscoveryFingerprint(state: WizardSourceState): string {
  return connectionConfigFingerprint(
    state.connect.gitHost.providerId,
    state.connect.gitHost.config ?? {},
  );
}

/**
 * Input staleness (#132): the recorded selection was produced from a git-host
 * connection configuration that is no longer current — a provider or config
 * edit after selection. This is never TanStack Query's cache-freshness
 * `isStale`; it is a comparison of the recorded provenance against the
 * connection as it stands now. A restored selection with no recorded
 * provenance is out of date, so old drafts cannot bypass revalidation.
 */
export function isRepositorySelectionStale(state: WizardSourceState): boolean {
  if (state.repositories.selectedRepoIds.length === 0) {
    return false;
  }
  return (
    state.repositories.selectionFingerprint !==
    gitHostDiscoveryFingerprint(state)
  );
}

/**
 * The step-3 progression rule: a current application-repository selection
 * exists. Stale selections block, so a project can never be created from a
 * selection made under a connection that has since changed.
 */
export function canAdvanceFromRepositories(state: WizardSourceState): boolean {
  return hasApplicationRepository(state) && !isRepositorySelectionStale(state);
}
