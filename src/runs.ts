// src/runs.ts — Run lifecycle management, public service facade, and backward-compatible exports.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { CommandRepository } from "./db/command-repository.js";
import { createDatabase } from "./db/connection.js";
import { type EventRecord, EventRepository } from "./db/event-repository.js";
import { type JobRecord, JobRepository } from "./db/job-repository.js";
import { runMigrations } from "./db/migrator.js";
import {
  type OperationLedgerRecord,
  OperationLedgerRepository,
} from "./db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "./db/run-repository.js";
import {
  type StageAttemptRecord,
  StageAttemptRepository,
} from "./db/stage-attempt-repository.js";
import * as git from "./git.js";
import { getRunDir, getWorktreePath } from "./paths.js";
import { STOPPABLE_RUN_STATUSES } from "./state-machine.js";
import { initializeRunArtifacts } from "./store.js";
import type { Project, PullRequest, Run, RunStatus, Ticket } from "./types.js";

let hydrationPromise: Promise<void> | null = null;
let dbInstance: Database | null = null;
let runRepoInstance: RunRepository | null = null;
let jobRepoInstance: JobRepository | null = null;
let eventRepoInstance: EventRepository | null = null;
let commandRepoInstance: CommandRepository | null = null;
let stageAttemptRepoInstance: StageAttemptRepository | null = null;
let operationLedgerRepoInstance: OperationLedgerRepository | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = createDatabase();
    runMigrations(dbInstance);
  }
  return dbInstance;
}

export function getRunRepository(): RunRepository {
  if (!runRepoInstance) {
    runRepoInstance = new RunRepository(getDb());
  }
  return runRepoInstance;
}

export function getJobRepository(): JobRepository {
  if (!jobRepoInstance) {
    jobRepoInstance = new JobRepository(getDb());
  }
  return jobRepoInstance;
}

export function getEventRepository(): EventRepository {
  if (!eventRepoInstance) {
    eventRepoInstance = new EventRepository(getDb());
  }
  return eventRepoInstance;
}

export function getCommandRepository(): CommandRepository {
  if (!commandRepoInstance) {
    commandRepoInstance = new CommandRepository(getDb());
  }
  return commandRepoInstance;
}

export function getStageAttemptRepository(): StageAttemptRepository {
  if (!stageAttemptRepoInstance) {
    stageAttemptRepoInstance = new StageAttemptRepository(getDb());
  }
  return stageAttemptRepoInstance;
}

export function getOperationLedgerRepository(): OperationLedgerRepository {
  if (!operationLedgerRepoInstance) {
    operationLedgerRepoInstance = new OperationLedgerRepository(getDb());
  }
  return operationLedgerRepoInstance;
}

export function setDbForTesting(db: Database | null): void {
  dbInstance = db;
  runRepoInstance = db ? new RunRepository(db) : null;
  jobRepoInstance = db ? new JobRepository(db) : null;
  eventRepoInstance = db ? new EventRepository(db) : null;
  commandRepoInstance = db ? new CommandRepository(db) : null;
  operationLedgerRepoInstance = db ? new OperationLedgerRepository(db) : null;
  stageAttemptRepoInstance = db ? new StageAttemptRepository(db) : null;
}

export function getRunEvents(
  runId: string,
  options?: { sinceSequence?: number | undefined },
): EventRecord[] {
  return getEventRepository().getEventsForRun(runId, options);
}

export function getStageAttempts(runId: string): StageAttemptRecord[] {
  return getStageAttemptRepository().listForRun(runId);
}

export function getOperationLedger(runId: string): OperationLedgerRecord[] {
  return getOperationLedgerRepository().listForRun(runId);
}

export async function initRuns(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      getDb();
    })();
  }
  return hydrationPromise;
}

export function getRun(id: string): Run | null {
  return getRunRepository().get(id);
}

export function listRuns(): Run[] {
  return getRunRepository().list();
}

export function generateBranchName(
  ticketId: string,
  ticketTitle?: string,
  runId?: string,
): string {
  const cleanId = ticketId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
  const slug = (ticketTitle || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  const suffix = runId ? `-${runId}` : "";
  return slug
    ? `factory/${cleanId}-${slug}${suffix}`
    : `factory/${cleanId}${suffix}`;
}

export async function createRun(
  project: Project,
  ticketId: string,
  ticketTitle: string,
  plan: string,
  acceptanceCriteria: string[] = [],
  ticketDescription?: string,
  customBranch?: string,
): Promise<Run> {
  if (!project) throw new Error("Project is required.");
  if (!ticketId?.trim()) throw new Error("Ticket ID is required.");
  if (!plan?.trim()) throw new Error("Implementation plan is required.");

  await git.validateRepo(project.repositoryPath);

  const id = randomUUID().slice(0, 8);
  const cleanTicketId = ticketId.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  const branchName =
    customBranch?.trim() || generateBranchName(cleanTicketId, ticketTitle, id);

  const artifactsDir = getRunDir(project.id, id);
  const worktreePath = getWorktreePath(project.id, id);

  const ticket: Ticket = {
    id: cleanTicketId,
    title: ticketTitle.trim() || cleanTicketId,
    description: ticketDescription,
    acceptanceCriteria: acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
  };

  // Create run artifacts before exposing pending job in database (Phase 1, Section 19)
  await initializeRunArtifacts(artifactsDir, ticket, plan);

  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();
  const eventRepo = getEventRepository();

  let createdRun: RunRecord | null = null;

  const atomicInit = db.transaction(() => {
    createdRun = runRepo.create(
      {
        id,
        projectId: project.id,
        projectName: project.name,
        ticket,
        plan,
        branch: branchName,
        status: "preparing",
        artifactsDir,
        worktreePath,
      },
      db,
    );

    jobRepo.createJob(
      {
        runId: id,
        stage: "prepare",
        status: "pending",
      },
      db,
    );

    eventRepo.appendEvent(
      id,
      "status",
      {
        status: "preparing",
        text: "Preparing run workspace…",
      },
      db,
    );
  });
  atomicInit();

  if (!createdRun) {
    throw new Error("Failed to initialize run record");
  }

  return createdRun;
}

export async function steerRun(
  id: string,
  message: string,
  commandId?: string,
): Promise<boolean> {
  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();
  const commandRepo = getCommandRepository();
  const eventRepo = getEventRepository();

  const idempotencyKey = commandId
    ? `steer:${commandId}`
    : `steer:${randomUUID()}`;
  let alreadyExisted = false;

  const tx = db.transaction(() => {
    const run = runRepo.get(id, db);
    if (!run) throw new Error(`Run ${id} not found.`);
    if (run.status !== "implementing") {
      throw new Error(`Cannot steer in status "${run.status}".`);
    }

    if (commandId) {
      const existingCmd = db
        .prepare<{ id: string }, [string]>(
          "SELECT id FROM run_commands WHERE idempotency_key = ?;",
        )
        .get(idempotencyKey);

      if (existingCmd) {
        alreadyExisted = true;
        return;
      }
    }

    const activeJob = jobRepo.findActiveJobForRun(id, db);
    const targetWorkerId = activeJob?.workerId || null;

    commandRepo.insertOrRetryCommand(
      {
        runId: id,
        command: "steer",
        payload: { message },
        idempotencyKey,
        targetWorkerId,
      },
      db,
    );

    eventRepo.appendEvent(id, "steer", { message }, db);
  });
  tx();

  return alreadyExisted;
}

export async function stopRun(
  id: string,
  deps?: {
    db?: Database;
    runRepo?: RunRepository;
    jobRepo?: JobRepository;
    commandRepo?: CommandRepository;
    eventRepo?: EventRepository;
  },
): Promise<RunRecord> {
  const db = deps?.db ?? getDb();
  const runRepo = deps?.runRepo ?? getRunRepository();
  const jobRepo = deps?.jobRepo ?? getJobRepository();
  const commandRepo = deps?.commandRepo ?? getCommandRepository();

  const tx = db.transaction((): RunRecord => {
    const run = runRepo.get(id, db);
    if (!run) throw new Error(`Run ${id} not found.`);

    if (run.status === "stopped") {
      return run;
    }

    if (!STOPPABLE_RUN_STATUSES.has(run.status)) {
      throw new Error(`Cannot stop in status "${run.status}".`);
    }

    // Capture active job before cancellation clears worker_id
    const activeJob = jobRepo.findActiveJobForRun(id, db);

    const transitionResult = runRepo.transitionRun(
      id,
      run.status,
      "stopped",
      {
        event: {
          type: "status",
          payload: {
            status: "stopped",
            text: "Run stopped by user.",
          },
        },
      },
      db,
    );

    cancelAndStopActiveJob(
      jobRepo,
      commandRepo,
      id,
      activeJob,
      "Run stopped by user.",
      db,
    );

    return transitionResult.run;
  });

  return tx();
}

function cancelAndStopActiveJob(
  jobRepo: JobRepository,
  commandRepo: CommandRepository,
  runId: string,
  activeJob: JobRecord | null,
  reason: string,
  db: Database,
): void {
  jobRepo.cancelJobsForRun(runId, reason, db);
  if (activeJob?.workerId) {
    commandRepo.insertOrRetryCommand(
      {
        runId,
        command: "stop",
        payload: { jobId: activeJob.id },
        idempotencyKey: `stop:${runId}`,
        targetWorkerId: activeJob.workerId,
      },
      db,
    );
  }
}

function verifyRecoveryRequired(
  runRepo: RunRepository,
  id: string,
  db: Database,
  action: string,
): RunRecord {
  const dbRun = runRepo.get(id, db);
  if (!dbRun) throw new Error(`Run ${id} not found.`);
  if (dbRun.status !== "recovery_required") {
    throw new Error(
      `Cannot ${action} run in status "${dbRun.status}". Run must be in "recovery_required".`,
    );
  }
  return dbRun;
}

export async function createPR(
  id: string,
  deps?: {
    db?: Database;
    runRepo?: RunRepository;
    commandRepo?: CommandRepository;
    eventRepo?: EventRepository;
  },
): Promise<{
  ok: boolean;
  queued?: boolean | undefined;
  completed?: boolean | undefined;
  prUrl?: string | undefined;
  pullRequest?: PullRequest | undefined;
}> {
  const db = deps?.db ?? getDb();
  const runRepo = deps?.runRepo ?? getRunRepository();
  const commandRepo = deps?.commandRepo ?? getCommandRepository();
  const eventRepo = deps?.eventRepo ?? getEventRepository();

  type CreatePrResult = {
    ok: boolean;
    queued?: boolean | undefined;
    completed?: boolean | undefined;
    url?: string | undefined;
    prUrl?: string | undefined;
    pullRequest?: PullRequest | undefined;
  };

  const tx = db.transaction((): CreatePrResult => {
    const run = runRepo.get(id, db);
    if (!run) throw new Error(`Run ${id} not found.`);

    if (run.pullRequest) {
      return {
        ok: true,
        completed: true,
        url: run.pullRequest.url,
        prUrl: run.pullRequest.url,
        pullRequest: run.pullRequest,
      };
    }

    if (run.status !== "ready_for_pr") {
      throw new Error(
        `Cannot create PR in status "${run.status}". Run must be in "ready_for_pr".`,
      );
    }

    const existingCmd = commandRepo.getCommand(`deliver:${id}`, db);
    if (existingCmd) {
      if (
        existingCmd.status === "pending" ||
        existingCmd.status === "claimed"
      ) {
        return { ok: true, queued: true };
      }
      if (existingCmd.status === "completed") {
        const refreshed = runRepo.get(id, db);
        return {
          ok: true,
          completed: true,
          url: refreshed?.pullRequest?.url,
          prUrl: refreshed?.pullRequest?.url,
          pullRequest: refreshed?.pullRequest ?? undefined,
        };
      }
      if (existingCmd.status === "failed") {
        commandRepo.insertOrRetryCommand(
          {
            runId: id,
            command: "deliver",
            idempotencyKey: `deliver:${id}`,
          },
          db,
        );
        return { ok: true, queued: true };
      }
    }

    commandRepo.insertOrRetryCommand(
      {
        runId: id,
        command: "deliver",
        idempotencyKey: `deliver:${id}`,
      },
      db,
    );

    eventRepo.appendEvent(
      id,
      "info",
      { text: "Pull Request delivery queued" },
      db,
    );

    return { ok: true, queued: true };
  });

  return tx();
}

export async function resumeRun(id: string): Promise<Run> {
  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();
  const stageAttemptRepo = getStageAttemptRepository();

  const tx = db.transaction((): RunRecord => {
    verifyRecoveryRequired(runRepo, id, db, "resume");

    const attempts = stageAttemptRepo.listForRun(id, db);
    const lastAttempt =
      attempts.length > 0 ? attempts[attempts.length - 1] : null;
    const targetStage = lastAttempt?.stage || "prepare";
    const stageToStatus: Record<string, RunStatus> = {
      prepare: "preparing",
      understand: "understanding",
      implement: "implementing",
      verify: "verifying",
      review: "reviewing",
    };
    const targetStatus: RunStatus =
      stageToStatus[targetStage] || "implementing";

    const transitionResult = runRepo.transitionRun(
      id,
      "recovery_required",
      targetStatus,
      {
        event: {
          type: "status",
          payload: {
            status: targetStatus,
            text: `Run resumed by operator into stage ${targetStage}.`,
          },
        },
      },
      db,
    );

    jobRepo.createJob({ runId: id, stage: targetStage }, db);
    return transitionResult.run;
  });

  return tx();
}

export async function abandonRun(id: string): Promise<Run> {
  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();
  const commandRepo = getCommandRepository();

  const tx = db.transaction((): RunRecord => {
    verifyRecoveryRequired(runRepo, id, db, "abandon");

    const activeJob = jobRepo.findActiveJobForRun(id, db);

    const transitionResult = runRepo.transitionRun(
      id,
      "recovery_required",
      "failed",
      {
        event: {
          type: "status",
          payload: {
            status: "failed",
            text: "Run abandoned by operator.",
          },
        },
      },
      db,
    );

    cancelAndStopActiveJob(
      jobRepo,
      commandRepo,
      id,
      activeJob,
      "Run abandoned by operator.",
      db,
    );

    return transitionResult.run;
  });

  return tx();
}
