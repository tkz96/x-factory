// src/frontend/lib/setup-checklist.ts — The first-run checklist, derived from
// real state (spec #241, ticket #269).
//
// THE rule this module exists for: a step NEVER reports progress the app cannot
// see. Every tick comes from the same state the screens read — a project exists,
// a connection has passed Check Connection and both roles have a model, a run
// has started — and a step that cannot be determined is not ticked. The welcome
// screen renders the gaps this returns in plain words.
//
// The model step mirrors the server's own role readiness (#278,
// `src/model-roles.ts`): a role is ready only when its assignment names a model
// on a connection that has been checked, which is exactly the rule the Roles
// list in Settings › Models offers choices by.

import type { ModelConnectionView } from "../../shared/model-connection-types.js";
import type { ModelRoles, Project, Run } from "../../shared/types.js";

/** The three steps of the welcome, in the order the screen shows them. */
export type SetupStepId = "project" | "model" | "run";

/** What a step still needs. Consumed as copy by the screen, never rendered raw. */
export type SetupGap =
  | "no-project"
  | "no-verified-connection"
  | "roles-not-set"
  | "no-run";

export interface SetupStep {
  readonly id: SetupStepId;
  /** True only when the state this step is about is really there. */
  readonly done: boolean;
  /** What the step still needs; empty when `done`. */
  readonly gaps: readonly SetupGap[];
}

export interface SetupChecklist {
  readonly steps: readonly SetupStep[];
  readonly doneCount: number;
  /** Every step done: the welcome has nothing left to ask for. */
  readonly complete: boolean;
}

export interface SetupState {
  /** The projects the app can work on (the active list, as every screen reads it). */
  readonly projects: readonly Project[];
  readonly runs: readonly Run[];
  readonly connections: readonly ModelConnectionView[];
  readonly roles: ModelRoles | undefined;
}

interface ModelChoice {
  readonly connectionId: string;
  readonly modelId: string;
}

/**
 * Every model a user may assign a role to: the models recorded on a connection
 * that has passed Check Connection (#278). An unchecked connection offers
 * nothing, so a role pointing at it is not ready.
 */
function verifiedChoices(
  connections: readonly ModelConnectionView[],
): readonly ModelChoice[] {
  return connections
    .filter((connection) => connection.verifiedAt !== null)
    .flatMap((connection) =>
      connection.models.map((model) => ({
        connectionId: connection.id,
        modelId: model.modelId,
      })),
    );
}

/** True when the role's model is a choice a verified connection really offers. */
function roleIsReady(
  roles: ModelRoles | undefined,
  role: "builder" | "reviewer",
  choices: readonly ModelChoice[],
): boolean {
  const assignment = roles?.[role];
  if (assignment === undefined) return false;
  return choices.some(
    (choice) =>
      choice.connectionId === assignment.connectionId &&
      choice.modelId === assignment.modelId,
  );
}

function modelStep(state: SetupState): SetupStep {
  const choices = verifiedChoices(state.connections);
  const gaps: SetupGap[] = [];
  if (choices.length === 0) gaps.push("no-verified-connection");
  if (
    !roleIsReady(state.roles, "builder", choices) ||
    !roleIsReady(state.roles, "reviewer", choices)
  ) {
    gaps.push("roles-not-set");
  }
  return { id: "model", done: gaps.length === 0, gaps };
}

/**
 * The checklist for the state in front of the user: one entry per step, in
 * order, each with the gaps it still has.
 */
export function deriveSetupChecklist(state: SetupState): SetupChecklist {
  const steps: SetupStep[] = [
    {
      id: "project",
      done: state.projects.length > 0,
      gaps: state.projects.length > 0 ? [] : ["no-project"],
    },
    modelStep(state),
    {
      id: "run",
      done: state.runs.length > 0,
      gaps: state.runs.length > 0 ? [] : ["no-run"],
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
}
