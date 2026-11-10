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

import type { GitIdentity } from "../../../shared/types.js";
import { connectionConfigFingerprint } from "../../lib/connection-fingerprint.js";
import type {
  WizardInspectionState,
  WizardRepoConfig,
  WizardSourceState,
} from "../types.js";

/** Namespace so inspection digests can never collide with connection digests. */
const INSPECTION_FINGERPRINT_NAMESPACE = "inspection";

/** Read when a repository has no folder on this machine: its git config is the global one. */
const HOME_FOLDER = "~";

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
  /** The identity chosen for THIS project: read from git config, then edited. */
  gitIdentity?: GitIdentity | undefined;
  /** The identity git config gave when last read: the pre-fill and its source. */
  readIdentity?: GitIdentity | undefined;
  unresolvedRepoIds: string[];
  inputsFingerprint: string;
  inspectedPath?: string | undefined;
  isGitRepo?: boolean | undefined;
  topLevelDir?: string | undefined;
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
  /** True when the project's identity is complete: a name and an email. */
  identityResolved: boolean;
}

/** True when an identity can author a commit: a name, and an email with "@". */
export function isCompleteIdentity(
  identity: GitIdentity | undefined,
): identity is GitIdentity {
  return (
    identity !== undefined &&
    identity.name.trim() !== "" &&
    identity.email.trim().includes("@")
  );
}

/**
 * The identity to show after a (re-)read: what the user chose stays, unless it
 * is still just the earlier pre-fill, in which case the new read replaces it.
 */
export function identityAfterRead(
  chosen: GitIdentity | undefined,
  previousRead: GitIdentity | undefined,
  read: GitIdentity | undefined,
): GitIdentity | undefined {
  if (chosen === undefined) return read;
  const untouched =
    previousRead !== undefined &&
    chosen.name === previousRead.name &&
    chosen.email === previousRead.email;
  return untouched ? read : chosen;
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
 * the executor's worktree is created under. With neither, the home folder is
 * read, which gives the global git configuration: a repository that is not
 * cloned yet commits with that identity. Repositories sharing a directory are
 * read once.
 */
export function inspectionTargets(
  inputs: InspectionInputs,
): InspectionTarget[] {
  const targets: InspectionTarget[] = [];
  for (const id of inputs.selectedRepoIds) {
    const path =
      inputs.repoConfigs[id]?.localPath?.trim() ||
      inputs.workspacePath.trim() ||
      HOME_FOLDER;
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
    readIdentity: inspection.readIdentity,
    unresolvedRepoIds: inspection.unresolvedRepoIds ?? [],
    inputsFingerprint: inspection.inputsFingerprint,
    inspectedPath: inspection.inspectedPath,
    isGitRepo: inspection.isGitRepo,
    topLevelDir: inspection.topLevelDir,
  };
}

/** Derives the whole inspection status from the reducer's source state. */
export function deriveInspectionStatus(
  state: WizardSourceState,
): InspectionStatus {
  const inputs = inspectionInputsOf(state);
  const fingerprint = inspectionInputsFingerprint(inputs);
  const record = recordOf(state.inspection);
  const identityResolved = isCompleteIdentity(record?.gitIdentity);
  const targets = inspectionTargets(inputs);
  return {
    fingerprint,
    targets,
    record,
    // Nothing to inspect cannot be out of date: with no target at all the
    // region shows its own guidance, never an "out of date" badge.
    stale:
      targets.length > 0 &&
      record !== null &&
      record.inputsFingerprint !== fingerprint,
    identityResolved,
  };
}
