// src/executors/types.ts — The executor contract (#190). An executor gets a narrow context
// (inputs, an emit callback, an abort signal) and returns what it produced. It holds no
// repository: the stage runner (src/stage-runner.ts) commits the returned record together
// with the transition, or not at all.

import type { RunRecord } from "../db/run-repository.js";
import type {
  ImplementationContext,
  Project,
  PullRequest,
  ReviewResult,
  RunEventPayloadMap,
  RunEventType,
  VerificationResult,
} from "../shared/types.js";

/** An event an executor emits while it works. It is appended at once and is never output. */
export type EmitEvent = <T extends RunEventType>(
  type: T,
  payload: RunEventPayloadMap[T],
) => void;

/**
 * Idempotent external mutations (branch, worktree, commit, push, PR). The ledger is bound to
 * the run being executed, so an executor cannot reach another run's operations.
 */
export interface StageLedger {
  execute<T>(
    operation: string,
    fn: () => Promise<{ externalId?: string | null | undefined; result: T }>,
    reconcile?: (metadata?: unknown) => Promise<{
      externalId?: string | null | undefined;
      result: T;
    } | null>,
    prepareContext?: () => Promise<unknown>,
  ): Promise<T>;
}

/** The inputs and capabilities a stage executes with. */
export interface StageContext {
  /** The run as it was when the attempt started. */
  run: RunRecord;
  project: Project;
  stage: string;
  /** 1-based attempt number of the job or command being executed. */
  attempt: number;
  workerId: string;
  emit: EmitEvent;
  ledger: StageLedger;
  signal: AbortSignal;
}

/** The run fields a stage may write. */
export interface StageRunUpdate {
  plan?: string | undefined;
  worktreePath?: string | undefined;
  implementationContext?: ImplementationContext | undefined;
  verification?: VerificationResult | undefined;
  diff?: string | undefined;
  review?: ReviewResult | undefined;
  pullRequest?: PullRequest | undefined;
}

export type StageEvent = {
  [T in RunEventType]: { type: T; payload: RunEventPayloadMap[T] };
}[RunEventType];

/**
 * What a stage wants persisted. The runner writes it in the same transaction as the job and
 * run transition, and only if the run was not stopped meanwhile.
 */
export interface StageRecord {
  run?: StageRunUpdate | undefined;
  events?: readonly StageEvent[] | undefined;
  /** Extra fields for the status event of the transition the passed stage causes. */
  statusPayload?: Record<string, unknown> | undefined;
}

/**
 * What a stage produced. Executors return only an outcome; where the run goes next is decided
 * by the workflow module (src/workflow.ts). A rejection is a terminal verdict, not a failure
 * to retry.
 */
export type StageOutcome =
  | { outcome: "passed"; output?: unknown; record?: StageRecord | undefined }
  | {
      outcome: "rejected";
      reason: string;
      output?: unknown;
      record?: StageRecord | undefined;
    }
  | {
      outcome: "error";
      error: string;
      output?: unknown;
      record?: StageRecord | undefined;
    };

export interface StageExecutor {
  readonly stage: string;
  execute(context: StageContext): Promise<StageOutcome>;
}
