// src/runs.ts — Run lifecycle management, public service facade, and backward-compatible exports.

import type { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type ChatMessageInput, chatWithModel } from "./agents/pi.js";
import { CommandRepository } from "./db/command-repository.js";
import { createDatabase } from "./db/connection.js";
import { DiagnosticsRepository } from "./db/diagnostics-repository.js";
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
import { ConflictError, NotFoundError } from "./errors.js";
import * as git from "./git.js";
import { getRunDir, getWorktreePath } from "./paths.js";
import { loadSettings } from "./settings.js";
import { canRunAction, type RunAction } from "./shared/run-status-policy.js";
import { initializeRunArtifacts } from "./store.js";
import type { Project, PullRequest, Run, Ticket } from "./types.js";
import {
  APPROVE_ROUTES,
  assertRunAction,
  REQUEUE_ROUTE,
  RESTART_ROUTE,
  resumeRouteFor,
} from "./workflow.js";

let hydrationPromise: Promise<void> | null = null;

const dbStorage = new AsyncLocalStorage<Database | null>();

// Global fallback DB when not in a test context
let defaultDbInstance: Database | null = null;

const runRepoCache = new WeakMap<Database, RunRepository>();
const jobRepoCache = new WeakMap<Database, JobRepository>();
const eventRepoCache = new WeakMap<Database, EventRepository>();
const commandRepoCache = new WeakMap<Database, CommandRepository>();
const stageAttemptRepoCache = new WeakMap<Database, StageAttemptRepository>();
const diagnosticsRepoCache = new WeakMap<Database, DiagnosticsRepository>();
const operationLedgerRepoCache = new WeakMap<
  Database,
  OperationLedgerRepository
>();

export function getDb(): Database {
  const storeDb = dbStorage.getStore();
  if (storeDb) return storeDb;

  if (!defaultDbInstance) {
    defaultDbInstance = createDatabase();
    runMigrations(defaultDbInstance);
  }
  return defaultDbInstance;
}

export function getRunRepository(): RunRepository {
  const db = getDb();
  let repo = runRepoCache.get(db);
  if (!repo) {
    repo = new RunRepository(db);
    runRepoCache.set(db, repo);
  }
  return repo;
}

export function getJobRepository(): JobRepository {
  const db = getDb();
  let repo = jobRepoCache.get(db);
  if (!repo) {
    repo = new JobRepository(db);
    jobRepoCache.set(db, repo);
  }
  return repo;
}

export function getEventRepository(): EventRepository {
  const db = getDb();
  let repo = eventRepoCache.get(db);
  if (!repo) {
    repo = new EventRepository(db);
    eventRepoCache.set(db, repo);
  }
  return repo;
}

export function getCommandRepository(): CommandRepository {
  const db = getDb();
  let repo = commandRepoCache.get(db);
  if (!repo) {
    repo = new CommandRepository(db);
    commandRepoCache.set(db, repo);
  }
  return repo;
}

export function getDiagnosticsRepository(): DiagnosticsRepository {
  const db = getDb();
  let repo = diagnosticsRepoCache.get(db);
  if (!repo) {
    repo = new DiagnosticsRepository(db);
    diagnosticsRepoCache.set(db, repo);
  }
  return repo;
}

export function getStageAttemptRepository(): StageAttemptRepository {
  const db = getDb();
  let repo = stageAttemptRepoCache.get(db);
  if (!repo) {
    repo = new StageAttemptRepository(db);
    stageAttemptRepoCache.set(db, repo);
  }
  return repo;
}

export function getOperationLedgerRepository(): OperationLedgerRepository {
  const db = getDb();
  let repo = operationLedgerRepoCache.get(db);
  if (!repo) {
    repo = new OperationLedgerRepository(db);
    operationLedgerRepoCache.set(db, repo);
  }
  return repo;
}

export function setDbForTesting(db: Database | null): void {
  dbStorage.enterWith(db);
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
    if (!run) throw new NotFoundError(`Run ${id} not found.`);
    if (!canRunAction(run.status, "steer")) {
      throw new ConflictError(`Cannot steer in status "${run.status}".`);
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
    if (!run) throw new NotFoundError(`Run ${id} not found.`);

    if (run.status === "stopped") {
      return run;
    }

    if (!canRunAction(run.status, "stop")) {
      throw new ConflictError(`Cannot stop in status "${run.status}".`);
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
  action: RunAction,
): RunRecord {
  const dbRun = runRepo.get(id, db);
  if (!dbRun) throw new NotFoundError(`Run ${id} not found.`);
  assertRunAction(dbRun.status, action);
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
    if (!run) throw new NotFoundError(`Run ${id} not found.`);

    if (run.pullRequest) {
      return {
        ok: true,
        completed: true,
        url: run.pullRequest.url,
        prUrl: run.pullRequest.url,
        pullRequest: run.pullRequest,
      };
    }

    if (!canRunAction(run.status, "deliver")) {
      throw new ConflictError(
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
  const commandRepo = getCommandRepository();
  const stageAttemptRepo = getStageAttemptRepository();

  const tx = db.transaction((): RunRecord => {
    verifyRecoveryRequired(runRepo, id, db, "resume");

    const attempts = stageAttemptRepo.listForRun(id, db);
    const lastStage = attempts[attempts.length - 1]?.stage;
    const route = resumeRouteFor(lastStage);

    const transitionResult = runRepo.transitionRun(
      id,
      "recovery_required",
      route.to,
      {
        event: {
          type: "status",
          payload: {
            status: route.to,
            text: `Run resumed by operator into stage ${lastStage ?? "prepare"}.`,
          },
        },
      },
      db,
    );

    if (route.command) {
      commandRepo.insertOrRetryCommand(
        {
          runId: id,
          command: route.command,
          idempotencyKey: `${route.command}:${id}`,
        },
        db,
      );
    }
    if (route.jobStage) {
      jobRepo.createJob({ runId: id, stage: route.jobStage }, db);
    }
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

/**
 * Handle a chat message during an approval gate (understanding or plan).
 * Records the user message and generates a contextual agent response
 * based on the run's implementation context.
 */
export async function chatWithRun(
  id: string,
  message: string,
): Promise<{ ok: boolean; message: string }> {
  const runRepo = getRunRepository();
  const eventRepo = getEventRepository();

  const run = runRepo.get(id);
  if (!run) throw new NotFoundError(`Run ${id} not found.`);

  if (!canRunAction(run.status, "chat")) {
    throw new ConflictError(
      `Chat is only available during approval gates. Current status: "${run.status}".`,
    );
  }

  // Record user message as an event
  eventRepo.appendEvent(id, "chat_user", { text: message });

  // Build contextual response from implementation context
  const ctx = run.implementationContext
    ? ((typeof run.implementationContext === "string"
        ? JSON.parse(run.implementationContext)
        : run.implementationContext) as {
        relevantFiles?: string[];
        constraints?: string[];
        risks?: string[];
        architecturalNotes?: string;
        existingBehavior?: string;
      })
    : null;

  let agentResponse: string;

  try {
    const settings = await loadSettings();
    const providerId = settings.models?.sessionA?.provider || "anthropic";
    const modelId = settings.models?.sessionA?.model || "claude-3-7-sonnet";

    const events = eventRepo.getEventsForRun(id);
    const messages: ChatMessageInput[] = [];

    const phase =
      run.status === "awaiting_understanding_approval"
        ? "Understanding/Analysis phase"
        : run.status === "awaiting_plan_approval"
          ? "Planning phase"
          : "Review phase";

    messages.push({
      role: "system",
      content: `You are a senior software engineer grilling the user about their ticket implementation. You follow Matt Pocock's "grill-me" skill persona: be relentless, question their plan, look for edge cases, ask hard questions, ensure they have fully thought through constraints.
We are currently in the ${phase}. Keep your responses concise (like an iMessage chat).
Context:\n${JSON.stringify(ctx, null, 2)}`,
    });

    for (const e of events) {
      const payload = e.payload as { text?: string } | null | undefined;
      const text = payload?.text;
      if (text) {
        if (e.type === "chat_user") {
          messages.push({ role: "user", content: text });
        } else if (e.type === "chat_agent") {
          messages.push({ role: "assistant", content: text });
        }
      }
    }

    agentResponse = await chatWithModel(providerId, modelId, messages);
    if (!agentResponse?.trim()) {
      agentResponse =
        "I'm having trouble connecting to my brain. Please check your LLM configuration or approve/restart the phase manually.";
    }
  } catch (err) {
    console.error("LLM Chat Error:", err);
    agentResponse =
      "I'm having trouble connecting to my brain. Please check your LLM configuration or approve/restart the phase manually.";
  }

  // Record agent response as an event
  eventRepo.appendEvent(id, "chat_agent", { text: agentResponse });

  return { ok: true, message: agentResponse };
}

export async function handleTransition(
  id: string,
  action: "approve" | "restart" | "abort" | "requeue",
  _payload?: unknown,
): Promise<RunRecord> {
  if (action === "abort") {
    return stopRun(id);
  }

  const db = getDb();
  const runRepo = getRunRepository();
  const jobRepo = getJobRepository();
  const commandRepo = getCommandRepository();
  const eventRepo = getEventRepository();

  const tx = db.transaction((): RunRecord => {
    const run = runRepo.get(id, db);
    if (!run) throw new NotFoundError(`Run ${id} not found.`);

    if (action === "approve") {
      assertRunAction(run.status, "approve");
      const approval = APPROVE_ROUTES[run.status];
      if (!approval) {
        // The shared policy allows approve here but no transition is defined:
        // an internal inconsistency, not a client conflict.
        throw new Error(
          `Approve is allowed in status "${run.status}" but has no transition.`,
        );
      }
      const transitionResult = runRepo.transitionRun(
        id,
        run.status,
        approval.to,
        {
          event: {
            type: "status",
            payload: { status: approval.to, text: approval.text },
          },
        },
        db,
      );
      if (approval.nextStage) {
        jobRepo.createJob({ runId: id, stage: approval.nextStage }, db);
      }
      return transitionResult.run;
    }

    if (action === "restart") {
      assertRunAction(run.status, "restart");
      // Cancel any active jobs first
      const activeJob = jobRepo.findActiveJobForRun(id, db);
      if (activeJob) {
        cancelAndStopActiveJob(
          jobRepo,
          commandRepo,
          id,
          activeJob,
          "Run restarted.",
          db,
        );
      }

      const transitionResult = runRepo.transitionRun(
        id,
        run.status,
        RESTART_ROUTE.to,
        {
          event: {
            type: "status",
            payload: {
              status: RESTART_ROUTE.to,
              text: RESTART_ROUTE.text,
            },
          },
        },
        db,
      );
      jobRepo.createJob({ runId: id, stage: RESTART_ROUTE.nextStage }, db);
      return transitionResult.run;
    }

    if (action === "requeue") {
      assertRunAction(run.status, "requeue");
      const payload = _payload as
        | { failingTasks?: string[]; chatNotes?: string }
        | undefined;
      let requeueText = REQUEUE_ROUTE.text;
      if (payload?.chatNotes) {
        requeueText += ` Notes: ${payload.chatNotes}`;
      }

      let newPlan = run.plan;
      if (payload?.failingTasks && payload.failingTasks.length > 0) {
        newPlan += "\n\n### Requeue Feedback:\n";
        newPlan += payload.failingTasks.map((t) => `- Failed: ${t}`).join("\n");
      }
      if (payload?.chatNotes) {
        newPlan += `\nNotes: ${payload.chatNotes}\n`;
      }

      runRepo.update(id, { plan: newPlan, expectedRevision: run.revision }, db);

      const transitionResult = runRepo.transitionRun(
        id,
        run.status,
        REQUEUE_ROUTE.to,
        {
          event: {
            type: "status",
            payload: {
              status: REQUEUE_ROUTE.to,
              text: requeueText,
            },
          },
        },
        db,
      );

      if (
        payload?.chatNotes ||
        (payload?.failingTasks && payload.failingTasks.length > 0)
      ) {
        eventRepo.appendEvent(
          id,
          "user_feedback",
          {
            failingTasks: payload.failingTasks,
            notes: payload.chatNotes,
            text: `Feedback provided: ${payload.failingTasks?.length || 0} failing tasks.`,
          },
          db,
        );
      }

      jobRepo.createJob({ runId: id, stage: REQUEUE_ROUTE.nextStage }, db);
      return transitionResult.run;
    }

    throw new Error(`Unknown transition action: ${action}`);
  });

  return tx();
}
