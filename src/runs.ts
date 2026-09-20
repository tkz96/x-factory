// src/runs.ts — Run lifecycle management, public service facade, and backward-compatible exports.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { getActiveSession } from "./agents/pi.js";
import { loadProjects } from "./config.js";
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
import { defaultEventBus } from "./events.js";
import { DeliverExecutor } from "./executors/deliver.js";
import * as git from "./git.js";
import { getRunDir, getWorktreePath } from "./paths.js";
import { initializeRunArtifacts } from "./store.js";
import type {
  Project,
  PullRequest,
  Run,
  RunEvent,
  RunStatus,
  Ticket,
} from "./types.js";

const eventBus = defaultEventBus;

let hydrationPromise: Promise<void> | null = null;
let dbInstance: Database | null = null;
let runRepoInstance: RunRepository | null = null;
let jobRepoInstance: JobRepository | null = null;

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

let eventRepoInstance: EventRepository | null = null;

export function getEventRepository(): EventRepository {
  if (!eventRepoInstance) {
    eventRepoInstance = new EventRepository(getDb());
  }
  return eventRepoInstance;
}

export function setDbForTesting(db: Database | null): void {
  dbInstance = db;
  runRepoInstance = db ? new RunRepository(db) : null;
  jobRepoInstance = db ? new JobRepository(db) : null;
  eventRepoInstance = db ? new EventRepository(db) : null;
  operationLedgerRepoInstance = db ? new OperationLedgerRepository(db) : null;
  stageAttemptRepoInstance = db ? new StageAttemptRepository(db) : null;
}

export function getRunEvents(
  runId: string,
  options?: { sinceSequence?: number | undefined },
): EventRecord[] {
  return getEventRepository().getEventsForRun(runId, options);
}

let stageAttemptRepoInstance: StageAttemptRepository | null = null;

export function getStageAttemptRepository(): StageAttemptRepository {
  if (!stageAttemptRepoInstance) {
    stageAttemptRepoInstance = new StageAttemptRepository(getDb());
  }
  return stageAttemptRepoInstance;
}

export function getStageAttempts(runId: string): StageAttemptRecord[] {
  return getStageAttemptRepository().listForRun(runId);
}

let operationLedgerRepoInstance: OperationLedgerRepository | null = null;

export function getOperationLedgerRepository(): OperationLedgerRepository {
  if (!operationLedgerRepoInstance) {
    operationLedgerRepoInstance = new OperationLedgerRepository(getDb());
  }
  return operationLedgerRepoInstance;
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

  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();

  let createdRun: Run | null = null;

  // Atomically persist Run and initial Job in a single SQLite transaction
  const atomicInit = db.transaction(() => {
    createdRun = runRepo.create({
      id,
      projectId: project.id,
      projectName: project.name,
      ticket,
      plan,
      branch: branchName,
      status: "preparing",
      artifactsDir,
      worktreePath,
    });

    jobRepo.createJob({
      runId: id,
      stage: "prepare",
      status: "pending",
    });
  });
  atomicInit();

  await initializeRunArtifacts(artifactsDir, ticket, plan);

  eventBus.emit(id, {
    type: "status",
    status: "preparing",
    text: "Preparing run workspace…",
  });

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
  if (commandId) {
    const ledger = getOperationLedgerRepository();
    const existing = ledger.getOperation(id, `steer:${commandId}`);
    if (existing && existing.status === "completed") {
      return true; // deduplicated
    }
  }

  const run = getRunRepository().get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (run.status !== "implementing") {
    throw new Error(`Cannot steer in status "${run.status}".`);
  }

  const session = getActiveSession(id);
  if (!session) throw new Error("No active Pi session to steer.");

  eventBus.emit(id, { type: "steer", text: message });
  await session.steer(message);

  if (commandId) {
    const ledger = getOperationLedgerRepository();
    ledger.recordCompleted(id, `steer:${commandId}`, commandId, { message });
  }

  return false;
}

export async function stopRun(id: string): Promise<void> {
  const dbRun = getRunRepository().get(id);
  if (!dbRun) throw new Error(`Run ${id} not found.`);

  if (dbRun.status === "stopped") {
    // Idempotent no-op for double-click stop
    return;
  }

  if (
    dbRun.status !== "implementing" &&
    dbRun.status !== "understanding" &&
    dbRun.status !== "preparing"
  ) {
    throw new Error(`Cannot stop in status "${dbRun.status}".`);
  }

  const session = getActiveSession(id);
  if (session) {
    await session.abort();
  }

  getRunRepository().update(id, {
    status: "stopped",
    finishedAt: new Date().toISOString(),
  });

  eventBus.emit(id, {
    type: "status",
    status: "stopped",
    text: "Run stopped by user.",
  });
}

export async function createPR(id: string): Promise<PullRequest> {
  const dbRun = getRunRepository().get(id);
  if (!dbRun) throw new Error(`Run ${id} not found.`);

  const existingPr = dbRun.pullRequest;
  if (existingPr) {
    // Idempotent return for double PR creation
    return existingPr;
  }

  if (dbRun.status !== "ready_for_pr") {
    throw new Error(
      `Cannot create PR in status "${dbRun.status}". Status must be "ready_for_pr".`,
    );
  }

  const projects = await loadProjects();
  const project = projects.find((p) => p.id === dbRun.project.id);
  if (!project) {
    throw new Error(`Project ${dbRun.project.id} not found.`);
  }

  const deliverExecutor = new DeliverExecutor();
  const now = new Date().toISOString();
  const dummyJob: JobRecord = {
    id: `job-deliver-${id}`,
    runId: id,
    stage: "deliver",
    status: "claimed",
    workerId: "api-process",
    attempts: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseUntil: new Date(Date.now() + 60000).toISOString(),
    lastHeartbeatAt: now,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await deliverExecutor.execute({
    run: dbRun,
    job: dummyJob,
    project,
    workerId: "api-process",
    db: getDb(),
    runRepo: getRunRepository(),
    jobRepo: getJobRepository(),
    stageAttemptRepo: getStageAttemptRepository(),
    operationLedgerRepo: getOperationLedgerRepository(),
    eventRepo: getEventRepository(),
    attemptId: `attempt-deliver-${id}`,
  });

  return result.output as PullRequest;
}

function getRecoverableRun(
  id: string,
  action: "resume" | "abandon",
): RunRecord {
  const dbRun = getRunRepository().get(id);
  if (!dbRun) {
    throw new Error(`Run ${id} not found.`);
  }

  if (dbRun.status !== "recovery_required") {
    throw new Error(
      `Cannot ${action} run in status "${dbRun.status}". Run must be in "recovery_required".`,
    );
  }

  return dbRun;
}

export async function resumeRun(id: string): Promise<Run> {
  getRecoverableRun(id, "resume");

  // Determine stage to resume
  const attempts = getStageAttempts(id);
  const lastAttempt =
    attempts.length > 0 ? attempts[attempts.length - 1] : null;

  let targetStage = "prepare";
  let targetStatus: RunStatus = "preparing";

  if (lastAttempt) {
    targetStage = lastAttempt.stage;
    const stageToStatus: Record<string, RunStatus> = {
      prepare: "preparing",
      parse_issue: "preparing",
      understand: "understanding",
      implement: "implementing",
      verify: "verifying",
      review: "reviewing",
    };
    targetStatus = stageToStatus[targetStage] || "preparing";
  }

  getRunRepository().transitionRun(id, "recovery_required", targetStatus, {
    event: {
      type: "resumed",
      payload: {
        message: `Run resumed by operator from stage "${targetStage}".`,
      },
    },
  });
  getJobRepository().createJob({ runId: id, stage: targetStage });

  eventBus.emit(id, {
    type: "status",
    status: targetStatus,
    text: `Run resumed by operator. Stage "${targetStage}" enqueued.`,
  });

  const updated = getRun(id);
  if (!updated) throw new Error(`Run ${id} not found after resume.`);
  return updated;
}

export async function abandonRun(id: string): Promise<Run> {
  getRecoverableRun(id, "abandon");

  const now = new Date().toISOString();
  getRunRepository().transitionRun(id, "recovery_required", "failed", {
    finishedAt: now,
    event: {
      type: "abandoned",
      payload: { message: "Run abandoned by operator." },
    },
  });

  getJobRepository().cancelJobsForRun(id, "Run abandoned by operator.");

  eventBus.emit(id, {
    type: "status",
    status: "failed",
    text: "Run abandoned by operator.",
  });

  const updated = getRun(id);
  if (!updated) throw new Error(`Run ${id} not found after abandon.`);
  return updated;
}

export function subscribe(
  id: string,
  listener: (event: RunEvent) => void,
): () => void {
  return eventBus.subscribe(id, listener);
}
