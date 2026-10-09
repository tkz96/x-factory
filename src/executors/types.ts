// src/executors/types.ts — Common contracts and interfaces for workflow stage executors (XFM-28).

import type { Database } from "bun:sqlite";
import type { EventRepository } from "../db/event-repository.js";
import type { JobRecord, JobRepository } from "../db/job-repository.js";
import type { OperationLedgerRepository } from "../db/operation-ledger-repository.js";
import type { RunRecord, RunRepository } from "../db/run-repository.js";
import type { StageAttemptRepository } from "../db/stage-attempt-repository.js";
import type { Project } from "../shared/types.js";

export interface StageContext {
  run: RunRecord;
  job: JobRecord;
  project: Project;
  workerId: string;
  db: Database;
  runRepo: RunRepository;
  jobRepo: JobRepository;
  eventRepo: EventRepository;
  stageAttemptRepo: StageAttemptRepository;
  operationLedgerRepo: OperationLedgerRepository;
  attemptId: string;
  signal?: AbortSignal | undefined;
}

/**
 * What a stage produced. Executors return only an outcome; where the run goes next is decided
 * by the workflow module (src/workflow.ts). A rejection is a terminal verdict, not a failure
 * to retry.
 */
export type StageOutcome =
  | { outcome: "passed"; output?: unknown }
  | { outcome: "rejected"; reason: string; output?: unknown }
  | { outcome: "error"; error: string; output?: unknown };

export interface StageExecutor {
  readonly stage: string;
  execute(context: StageContext): Promise<StageOutcome>;
}
