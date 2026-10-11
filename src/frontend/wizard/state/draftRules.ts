// src/frontend/wizard/state/draftRules.ts — Pure rules about the draft the
// assistant holds (#268, spec #241 story 116).
//
// `wizardHasProgress` answers one question for the dismissal path: is there
// anything here the user would lose by closing? "Progress" is derived from the
// state itself — the step they reached and the values they entered — never from
// a flag that could go stale, and never from provider descriptors (a draft the
// user typed is progress whether or not its providers are configured yet).

import type { WizardSourceState } from "../types.js";

/** True when the wizard holds a value the user entered, or moved past step 1. */
export function wizardHasProgress(state: WizardSourceState): boolean {
  if (state.step > 1 || state.maxStepVisited > 1) {
    return true;
  }
  const { name, id, description, workspacePath } = state.basics;
  if (
    name.trim() !== "" ||
    id.trim() !== "" ||
    description.trim() !== "" ||
    workspacePath.trim() !== ""
  ) {
    return true;
  }
  if (state.connect.quickUrl.trim() !== "") {
    return true;
  }
  if (Object.keys(state.connect.providerConfigs).length > 0) {
    return true;
  }
  if (
    state.connect.tracker.providerId !== null ||
    state.connect.gitHost.providerId !== null
  ) {
    return true;
  }
  if (state.repositories.selectedRepoIds.length > 0) {
    return true;
  }
  if (
    state.inspection.gitIdentity !== undefined ||
    state.inspection.inspectedPath !== undefined
  ) {
    return true;
  }
  return state.review.confirmed;
}
