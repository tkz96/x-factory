// src/frontend/wizard/state/reviewRules.ts — Pure derived rules for the Review
// step (spec #133, #146).
//
// `isReviewReady` is a PURE derived predicate computed during render (#126):
// never stored in state, never synced in an effect. It is true only when every
// downstream value is current — both roles verified (a degraded-but-verified
// connection IS usable: #133 says degraded renders the partial state and never
// blocks), an application selection made under the current connection, and a
// git identity resolved for exactly those inputs.
//
// There is NO dismissal or skip path. A reason clears only by re-verifying the
// connection or re-inspecting the repository selection; `reviewBlockedReasons`
// names each one so the step can explain itself through the copy map.

import type { ProjectConnectionRole } from "../../../shared/types.js";
import {
  type ConnectionEvidence,
  isConnectionUsable,
} from "../../components/connections/connection-state.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import type { WizardSourceState } from "../types.js";
import { deriveInspectionStatus } from "./inspectionRules.js";
import {
  hasApplicationRepository,
  isRepositorySelectionStale,
} from "./repositoryRules.js";

/** Why the Review submit is blocked. Rendered through the copy map. */
export type ReviewBlockedReason =
  | "trackerUnverified"
  | "gitHostUnverified"
  | "noApplicationRepository"
  | "selectionStale"
  | "inspectionMissing"
  | "inspectionStale"
  | "identityUnresolved"
  | "identityPartial";

function roleReason(
  role: ProjectConnectionRole,
  evidence: ConnectionEvidence,
): ReviewBlockedReason | null {
  if (isConnectionUsable(evidence)) {
    return null;
  }
  return role === "tracker" ? "trackerUnverified" : "gitHostUnverified";
}

/**
 * Every reason the project cannot be created yet, in a stable order (upstream
 * connections first, then the repository selection, then the identity). An
 * empty list means the submit is unlocked.
 */
export function reviewBlockedReasons(
  state: WizardSourceState,
  descriptorOrDescriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): ReviewBlockedReason[] {
  const reasons: ReviewBlockedReason[] = [];

  const trackerReason = roleReason("tracker", state.connect.tracker);
  if (trackerReason) reasons.push(trackerReason);
  const gitHostReason = roleReason("gitHost", state.connect.gitHost);
  if (gitHostReason) reasons.push(gitHostReason);

  if (!hasApplicationRepository(state)) {
    reasons.push("noApplicationRepository");
  }
  if (isRepositorySelectionStale(state, descriptorOrDescriptors)) {
    reasons.push("selectionStale");
  }

  const inspection = deriveInspectionStatus(state);
  if (inspection.record === null) {
    reasons.push("inspectionMissing");
  } else if (inspection.stale) {
    reasons.push("inspectionStale");
  }
  if (!inspection.identityResolved) {
    reasons.push("identityUnresolved");
  } else if (inspection.partial) {
    reasons.push("identityPartial");
  }

  return reasons;
}

/** True only when nothing blocks the creation. */
export function isReviewReady(
  state: WizardSourceState,
  descriptorOrDescriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): boolean {
  return reviewBlockedReasons(state, descriptorOrDescriptors).length === 0;
}
