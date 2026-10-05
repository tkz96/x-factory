// src/frontend/wizard/state/inspectionRules.ts — Pure derived rules for the
// Inspection step (spec #133, ticket #146).
//
// Decided in #126: what was inspected, for which inputs, and whether it is
// still current are DERIVED at render time from the reducer's plain source
// state — never stored, never synced in an effect. The step's read region and
// the Review gate read these same functions, so the state a user sees and the
// state that blocks them cannot disagree.
//
// Staleness reuses the fingerprint technique #144 established
// (`connectionConfigFingerprint`, a non-reversible digest): the record carries
// the fingerprint of the inputs it was resolved from, and is out of date the
// moment the selection, a selected repository's role/local path, or the
// workspace root changes.

import { connectionConfigFingerprint } from "../../lib/connection-fingerprint.js";
import type {
  GitIdentity,
  WizardInspectionState,
  WizardRepoConfig,
  WizardSourceState,
} from "../types.js";

/** Namespace so inspection digests can never collide with connection digests. */
const INSPECTION_FINGERPRINT_NAMESPACE = "inspection";

/** The inputs the identity is resolved from. */
export interface InspectionInputs {
  workspacePath: string;
  selectedRepoIds: readonly string[];
  repoConfigs: Readonly<Record<string, WizardRepoConfig>>;
}

/** One directory git is read in, and the selected repositories read there. */
export interface InspectionTarget {
  path: string;
  repoIds: string[];
}

/** The recorded outcome of an inspection run, as persisted in wizard state. */
export interface InspectionRecord {
  gitIdentity?: GitIdentity | undefined;
  unresolvedRepoIds: string[];
  inputsFingerprint: string;
  inspectedPath?: string | undefined;
}

/** Everything the Inspection step and the Review gate derive about a record. */
export interface InspectionStatus {
  /** Fingerprint of the CURRENT inputs. */
  fingerprint: string;
  /** The directories to read, for the current inputs. */
  targets: InspectionTarget[];
  /** The recorded outcome, or null when nothing was ever resolved. */
  record: InspectionRecord | null;
  /** True when the record was resolved from inputs that are no longer current. */
  stale: boolean;
  /** True when a complete identity is recorded for the current inputs. */
  identityResolved: boolean;
  /** True when the identity resolved, but some selected repository resolved none. */
  partial: boolean;
}

/**
 * The digest of everything the resolved identity depends on: the workspace
 * root, the selection and its order, and each selected repository's role tags
 * and local path.
 */
export function inspectionInputsFingerprint(inputs: InspectionInputs): string {
  return connectionConfigFingerprint(INSPECTION_FINGERPRINT_NAMESPACE, {
    workspacePath: inputs.workspacePath,
    selection: inputs.selectedRepoIds.map((id) => {
      const config = inputs.repoConfigs[id];
      return {
        id,
        role: config?.role ?? null,
        roles: config?.roles ?? null,
        localPath: config?.localPath ?? null,
      };
    }),
  });
}

/**
 * The directories to read the git configuration in: a repository's own local
 * path when it has one, otherwise the project's workspace root — the directory
 * the executor's worktree is created under. Repositories sharing a directory
 * are read once; a selection with no directory to read at all yields none.
 */
export function inspectionTargets(
  inputs: InspectionInputs,
): InspectionTarget[] {
  const targets: InspectionTarget[] = [];
  for (const id of inputs.selectedRepoIds) {
    const path =
      inputs.repoConfigs[id]?.localPath?.trim() || inputs.workspacePath.trim();
    if (!path) {
      continue;
    }
    const existing = targets.find((target) => target.path === path);
    if (existing) {
      existing.repoIds.push(id);
    } else {
      targets.push({ path, repoIds: [id] });
    }
  }
  return targets;
}

function inspectionInputsOf(state: WizardSourceState): InspectionInputs {
  return {
    workspacePath: state.basics.workspacePath,
    selectedRepoIds: state.repositories.selectedRepoIds,
    repoConfigs: state.repositories.repoConfigs,
  };
}

/** Reads the record out of wizard state, or null when nothing was resolved. */
function recordOf(inspection: WizardInspectionState): InspectionRecord | null {
  if (typeof inspection.inputsFingerprint !== "string") {
    return null;
  }
  return {
    gitIdentity: inspection.gitIdentity,
    unresolvedRepoIds: inspection.unresolvedRepoIds ?? [],
    inputsFingerprint: inspection.inputsFingerprint,
    inspectedPath: inspection.inspectedPath,
  };
}

/** Derives the whole inspection status from the reducer's source state. */
export function deriveInspectionStatus(
  state: WizardSourceState,
): InspectionStatus {
  const inputs = inspectionInputsOf(state);
  const fingerprint = inspectionInputsFingerprint(inputs);
  const record = recordOf(state.inspection);
  const identityResolved = record?.gitIdentity !== undefined;
  return {
    fingerprint,
    targets: inspectionTargets(inputs),
    record,
    stale: record !== null && record.inputsFingerprint !== fingerprint,
    identityResolved,
    partial: identityResolved && (record?.unresolvedRepoIds.length ?? 0) > 0,
  };
}
