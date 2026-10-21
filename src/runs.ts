// src/runs.ts — Run lifecycle management, public service facade, and backward-compatible exports.
//
// Every entry point takes the process's `Repositories` bundle (composition
// root, #169). This module never opens a connection of its own.

import { randomUUID } from "node:crypto";
import {
  type ChatMessageInput,
  chatWithModel,
  classifyModelError,
} from "./agents/pi.js";
import type { Repositories } from "./composition-root.js";
import type { CommandRepository } from "./db/command-repository.js";
import type { EventRecord } from "./db/event-repository.js";
import type { JobRecord, JobRepository } from "./db/job-repository.js";
import type { OperationLedgerRecord } from "./db/operation-ledger-repository.js";
import type { RunRecord, RunRepository } from "./db/run-repository.js";
import type { StageAttemptRecord } from "./db/stage-attempt-repository.js";
import {
  ActiveRunExistsError,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import * as git from "./git.js";
import { assertBudgetNotExceeded, modelRoleForStage } from "./model-budgets.js";
import { ModelGateway, RateLimitedError } from "./model-gateway.js";
import {
  ModelUnavailableError,
  modelUse,
  type ResolvedModel,
  resolveRole,
  usageWithCost,
} from "./model-roles.js";
import { getRunDir, getWorktreePath } from "./paths.js";
import { buildChatSystemPrompt } from "./prompts.js";
import { formatApproxWait } from "./retry-delay.js";
import { OPERATOR_ABANDON_REASON } from "./shared/failure-reason.js";
import { canRunAction, type RunAction } from "./shared/run-status-policy.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  ModelRoleName,
  ModelUsage,
  ModelUse,
} from "./shared/types.js";
import { initializeRunArtifacts, removeRunArtifacts } from "./store.js";
import type { Project, PullRequest, Run, Ticket } from "./types.js";
import {
  APPROVE_ROUTES,
  assertRunAction,
  REQUEUE_ROUTE,
  RESTART_ROUTE,
  resumeRouteFor,
  resumeStageName,
} from "./workflow.js";

export function getRunEvents(
  repos: Repositories,
  runId: string,
  options?: { sinceSequence?: number | undefined },
): EventRecord[] {
  return repos.events.getEventsForRun(runId, options);
}

/**
 * Returns a consistent snapshot of current run statuses, Needs-you trigger events (no age limit)
 * and Finished history (last 7 days, max 100) with cursor inside one SQLite read transaction (#257, spec #241).
 */
export function getEventsSnapshot(
  repos: Repositories,
  options?: { sevenDaysAgo?: string | undefined },
): EventsSnapshot {
  const sevenDaysAgo =
    options?.sevenDaysAgo ??
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return repos.db.transaction(() => {
    const cursor = repos.events.getHighestEventId();
    const runsList = repos.runs.list();
    const needsYou = repos.events.getNeedsYouTriggerEvents(cursor);
    const finished = repos.events.getFinishedHistoryEvents(
      cursor,
      sevenDaysAgo,
    );

    return {
      cursor,
      runs: runsList,
      needsYou,
      finished,
    };
  })();
}

/**
 * Retrieves notification-relevant events across all runs with global id strictly greater than sinceId (#257).
 */
export function getAppEvents(
  repos: Repositories,
  sinceId: number,
  limit?: number,
): AppEventEnvelope[] {
  return repos.events.getAppEventsSince(sinceId, limit);
}

export function getStageAttempts(
  repos: Repositories,
  runId: string,
): StageAttemptRecord[] {
  return repos.stageAttempts.listForRun(runId);
}

export function getOperationLedger(
  repos: Repositories,
  runId: string,
): OperationLedgerRecord[] {
  return repos.operationLedger.listForRun(runId);
}

/**
 * Chat replies run inside an HTTP request, so a rate limit is waited out for
 * at most a minute before the reply says so (#280).
 */
const chatGateway = new ModelGateway({ maxWaitMs: 60_000 });

export function getRun(repos: Repositories, id: string): Run | null {
  const run = repos.runs.get(id);
  return run
    ? {
        ...run,
        stageModels: repos.stageAttempts.listModelsForRun(id),
        pullRequestOutcome: repos.events.getPullRequestOutcome(id) ?? undefined,
      }
    : null;
}

export function listRuns(repos: Repositories): Run[] {
  const models = repos.stageAttempts.listModelsByRun();
  const outcomes = repos.events.listPullRequestOutcomes();
  return repos.runs.list().map((run) => ({
    ...run,
    stageModels: models.get(run.id) ?? [],
    pullRequestOutcome: outcomes.get(run.id) ?? undefined,
  }));
}

/**
 * Asynchronously requests a pull request status check for a run in `pr_created`
 * by enqueueing a `check_pr` command into SQLite (#271).
 *
 * Returns true if a check was queued, or false if the run is not eligible:
 * - Run not found or not in `pr_created`
 * - Outcome already recorded (`pr_merged` or `pr_closed`)
 * - Run created more than 30 days ago
 * - An active (`pending` or `claimed`) `check_pr` command is already queued
 */
export function requestPullRequestCheck(
  repos: Repositories,
  runId: string,
  options?: { now?: Date | undefined },
): boolean {
  const { db, runs: runRepo, events: eventRepo, commands: commandRepo } = repos;

  return db.transaction((): boolean => {
    const run = runRepo.get(runId);
    if (run?.status !== "pr_created") {
      return false;
    }

    const outcome = eventRepo.getPullRequestOutcome(runId);
    if (outcome) {
      return false;
    }

    const now = options?.now ?? new Date();
    const createdTime = new Date(run.createdAt).getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    if (now.getTime() - createdTime > THIRTY_DAYS_MS) {
      return false;
    }

    if (commandRepo.hasActiveCommand(runId, "check_pr")) {
      return false;
    }

    commandRepo.insertOrRetryCommand({
      runId,
      command: "check_pr",
    });

    return true;
  })();
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
  repos: Repositories,
  project: Project,
  ticketId: string,
  ticketTitle: string,
  plan: string,
  acceptanceCriteria: string[] = [],
  ticketDescription?: string,
  customBranch?: string,
): Promise<Run> {
  // Missing input is the caller's mistake: a 400 with the reason, never a 500.
  if (!project) throw new ValidationError("Project is required.");
  if (!ticketId?.trim()) throw new ValidationError("Ticket ID is required.");

  // A missing folder is fine when there is a remote: the worker clones it in prepare.
  await git.checkRepositoryForRun({
    path: project.repositoryPath,
    remote: project.repositories[0]?.remote,
  });

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

  const { db } = repos;
  const runRepo = repos.runs;
  const jobRepo = repos.jobs;
  const eventRepo = repos.events;

  // One active run per ticket (#255). A quick check refuses before any file
  // is written. The run's files are then written before its pending job is
  // visible to a worker (Phase 1, Section 19), and the guard runs again inside
  // ONE immediate transaction with the insert: it takes the write lock before
  // reading, so a concurrent create waits, then sees the winner and is refused
  // with the winner's id. "Active" is the shared policy's set.
  const refuseIfActive = () => {
    const active = runRepo.findActiveRunForTicket(project.id, ticket.id);
    if (active) throw new ActiveRunExistsError(active.id, ticket.id);
  };
  refuseIfActive();
  await initializeRunArtifacts(artifactsDir, ticket, plan);

  const insertActiveRun = db.transaction((): RunRecord => {
    refuseIfActive();

    const created = runRepo.create({
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

    eventRepo.appendEvent(id, "status", {
      status: "preparing",
      text: "Preparing run workspace…",
    });

    return created;
  });

  // A run that lost the race (or failed to insert) leaves no files behind.
  let createdRun: RunRecord;
  try {
    createdRun = insertActiveRun.immediate();
  } catch (err) {
    await removeRunArtifacts(artifactsDir);
    throw err;
  }

  return createdRun;
}

export async function stopRun(
  repos: Repositories,
  id: string,
): Promise<RunRecord> {
  const { db, runs: runRepo, jobs: jobRepo, commands: commandRepo } = repos;

  const tx = db.transaction((): RunRecord => {
    const run = runRepo.get(id);
    if (!run) throw new NotFoundError(`Run ${id} not found.`);

    if (run.status === "stopped") {
      return run;
    }

    if (!canRunAction(run.status, "stop")) {
      throw new ConflictError(`Cannot stop in status "${run.status}".`);
    }

    // Capture active job before cancellation clears worker_id
    const activeJob = jobRepo.findActiveJobForRun(id);

    const transitionResult = runRepo.transitionRun(id, run.status, "stopped", {
      event: {
        type: "status",
        payload: {
          status: "stopped",
          text: "Run stopped by user.",
        },
      },
    });

    cancelAndStopActiveJob(
      jobRepo,
      commandRepo,
      id,
      activeJob,
      "Run stopped by user.",
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
): void {
  jobRepo.cancelJobsForRun(runId, reason);
  if (activeJob?.workerId) {
    commandRepo.insertOrRetryCommand({
      runId,
      command: "stop",
      payload: { jobId: activeJob.id },
      idempotencyKey: `stop:${runId}`,
      targetWorkerId: activeJob.workerId,
    });
  }
}

function verifyRecoveryRequired(
  runRepo: RunRepository,
  id: string,
  action: RunAction,
): RunRecord {
  const dbRun = runRepo.get(id);
  if (!dbRun) throw new NotFoundError(`Run ${id} not found.`);
  assertRunAction(dbRun.status, action);
  return dbRun;
}

export async function createPR(
  repos: Repositories,
  id: string,
): Promise<{
  ok: boolean;
  queued?: boolean | undefined;
  completed?: boolean | undefined;
  prUrl?: string | undefined;
  pullRequest?: PullRequest | undefined;
}> {
  const { db, runs: runRepo, commands: commandRepo, events: eventRepo } = repos;

  type CreatePrResult = {
    ok: boolean;
    queued?: boolean | undefined;
    completed?: boolean | undefined;
    url?: string | undefined;
    prUrl?: string | undefined;
    pullRequest?: PullRequest | undefined;
  };

  const tx = db.transaction((): CreatePrResult => {
    const run = runRepo.get(id);
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

    const existingCmd = commandRepo.getCommandByIdempotencyKey(`deliver:${id}`);
    if (existingCmd) {
      if (
        existingCmd.status === "pending" ||
        existingCmd.status === "claimed"
      ) {
        return { ok: true, queued: true };
      }
      if (existingCmd.status === "completed") {
        const refreshed = runRepo.get(id);
        return {
          ok: true,
          completed: true,
          url: refreshed?.pullRequest?.url,
          prUrl: refreshed?.pullRequest?.url,
          pullRequest: refreshed?.pullRequest ?? undefined,
        };
      }
      if (existingCmd.status === "failed") {
        commandRepo.insertOrRetryCommand({
          runId: id,
          command: "deliver",
          idempotencyKey: `deliver:${id}`,
        });
        return { ok: true, queued: true };
      }
    }

    commandRepo.insertOrRetryCommand({
      runId: id,
      command: "deliver",
      idempotencyKey: `deliver:${id}`,
    });

    eventRepo.appendEvent(id, "info", { text: "Pull Request delivery queued" });

    return { ok: true, queued: true };
  });

  return tx();
}

/**
 * Where a resume goes: the route out of recovery_required, the stage it
 * re-enters and the model role that stage calls (null when it calls none).
 * Resolved once before the model lookup and again inside the transaction,
 * because the attempts can change between the two.
 */
function resolveResumeTarget(attempts: ReadonlyArray<{ stage: string }>) {
  const stages = attempts.map((attempt) => attempt.stage);
  const route = resumeRouteFor(stages);
  const targetStage = resumeStageName(stages);
  const targetRole =
    modelRoleForStage(targetStage) ??
    (route.jobStage ? modelRoleForStage(route.jobStage) : null);
  return { route, targetStage, targetRole };
}

export async function resumeRun(
  repos: Repositories,
  id: string,
  options?: {
    resolveRole?: ((role: ModelRoleName) => Promise<ResolvedModel>) | undefined;
    now?: Date | undefined;
  },
): Promise<Run> {
  const { db } = repos;
  const runRepo = repos.runs;
  const jobRepo = repos.jobs;
  const commandRepo = repos.commands;
  const stageAttemptRepo = repos.stageAttempts;

  verifyRecoveryRequired(runRepo, id, "resume");

  const preliminaryTargetRole = resolveResumeTarget(
    stageAttemptRepo.listForRun(id),
  ).targetRole;
  let resolved: ResolvedModel | undefined;
  if (preliminaryTargetRole) {
    const resolver = options?.resolveRole ?? resolveRole;
    try {
      resolved = await resolver(preliminaryTargetRole);
    } catch (err: unknown) {
      if (err instanceof ModelUnavailableError) {
        throw new ConflictError(`Cannot resume run ${id}: ${err.message}`);
      }
      throw err;
    }
  }

  const tx = db.transaction((): RunRecord => {
    verifyRecoveryRequired(runRepo, id, "resume");

    const { route, targetStage, targetRole } = resolveResumeTarget(
      stageAttemptRepo.listForRun(id),
    );

    if (targetRole && resolved) {
      try {
        // The same rule the worker checks before a call: a spent budget (N of N
        // calls today) refuses the resume, one call left allows it (#281).
        assertBudgetNotExceeded(repos, resolved, options?.now);
      } catch (err: unknown) {
        if (err instanceof ModelUnavailableError) {
          throw new ConflictError(`Cannot resume run ${id}: ${err.message}`);
        }
        throw err;
      }
    }

    if (route.command) {
      // A completed deliver command means the PR already exists. Resuming into
      // ready_for_pr would strand the run with nothing left to run.
      const existing = commandRepo.getCommandByIdempotencyKey(
        `${route.command}:${id}`,
      );
      if (existing?.status === "completed") {
        throw new ConflictError(
          `Cannot resume run ${id}: its ${route.command} command already completed.`,
        );
      }
    }

    const transitionResult = runRepo.transitionRun(
      id,
      "recovery_required",
      route.to,
      {
        event: {
          type: "status",
          payload: {
            status: route.to,
            text: `Run resumed by operator into stage ${targetStage}.`,
          },
        },
      },
    );

    if (route.command) {
      commandRepo.insertOrRetryCommand({
        runId: id,
        command: route.command,
        idempotencyKey: `${route.command}:${id}`,
      });
    }
    if (route.jobStage) {
      jobRepo.createJob({ runId: id, stage: route.jobStage });
    }
    return transitionResult.run;
  });

  return tx();
}

export async function abandonRun(
  repos: Repositories,
  id: string,
  reason?: string,
): Promise<Run> {
  const { db } = repos;
  const runRepo = repos.runs;
  const jobRepo = repos.jobs;
  const commandRepo = repos.commands;

  // The operator's reason rides the abandon request (#182) and is recorded on
  // the terminal status event; without one, the generic text stands.
  const trimmedReason = reason?.trim();
  const statusText = trimmedReason
    ? `Run abandoned by operator: ${trimmedReason}`
    : "Run abandoned by operator.";

  const tx = db.transaction((): RunRecord => {
    verifyRecoveryRequired(runRepo, id, "abandon");

    const activeJob = jobRepo.findActiveJobForRun(id);

    const transitionResult = runRepo.transitionRun(
      id,
      "recovery_required",
      "failed",
      {
        event: {
          type: "status",
          payload: {
            status: "failed",
            text: statusText,
            // An abandoned run is a decision, not a crash: its structured reason says so (#256).
            failure: OPERATOR_ABANDON_REASON,
          },
        },
      },
    );

    cancelAndStopActiveJob(jobRepo, commandRepo, id, activeJob, statusText);

    return transitionResult.run;
  });

  return tx();
}

const EMPTY_REPLY_MESSAGE =
  "The model sent an empty reply. Retry, or check Settings › Models.";
const UNREACHABLE_MESSAGE =
  "Couldn't reach the model. Check Settings › Models.";

/**
 * Handle a chat message during an approval gate (understanding or plan).
 * Records the user message and generates a contextual agent response
 * based on the run's implementation context.
 */
export async function chatWithRun(
  repos: Repositories,
  id: string,
  message: string,
): Promise<{ ok: boolean; message: string }> {
  const runRepo = repos.runs;
  const eventRepo = repos.events;

  const run = runRepo.get(id);
  if (!run) throw new NotFoundError(`Run ${id} not found.`);

  if (!canRunAction(run.status, "chat")) {
    throw new ConflictError(
      `Chat is only available during approval gates. Current status: "${run.status}".`,
    );
  }

  // Record user message as an event
  eventRepo.appendEvent(id, "chat_user", { text: message });

  // Build contextual response from implementation context. The repository
  // already parsed the column through the row codec (#179), so the value is
  // the typed object (or null when absent or degraded) — never re-parse it
  // here.
  const ctx = run.implementationContext;

  let agentResponse = "";
  // Which model wrote the reply, and what it cost (#279); unset when none did.
  let replyModel: { model: ModelUse; usage: ModelUsage } | undefined;
  // A failed call is an error event with the reason, never an agent message (#263).
  let failure: string | null = null;

  try {
    // Chat uses the Builder role's model (#278); there is no fallback model.
    const resolved = await resolveRole("builder");

    const events = eventRepo.getEventsForRun(id);
    const messages: ChatMessageInput[] = [];

    const phase =
      run.status === "awaiting_understanding_approval"
        ? "understanding"
        : run.status === "awaiting_plan_approval"
          ? "plan"
          : "review";

    // The Builder answers the operator about its own work (see buildChatSystemPrompt).
    messages.push({
      role: "system",
      content: buildChatSystemPrompt({
        ticket: run.ticket,
        phase,
        plan: run.plan,
        understanding: ctx,
      }),
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

    const reply = await chatWithModel(resolved, messages, {
      gateway: chatGateway,
    });
    if (reply.text?.trim()) {
      agentResponse = reply.text;
      replyModel = {
        model: modelUse(resolved),
        usage: usageWithCost(resolved, reply.usage),
      };
    } else {
      failure = EMPTY_REPLY_MESSAGE;
    }
  } catch (err) {
    console.error("LLM Chat Error:", err);
    failure = chatFailureMessage(err);
  }

  if (failure !== null) {
    eventRepo.appendEvent(id, "error", { message: failure });
    return { ok: false, message: failure };
  }

  // Record agent response as an event
  eventRepo.appendEvent(id, "chat_agent", {
    text: agentResponse,
    ...(replyModel ?? {}),
  });

  return { ok: true, message: agentResponse };
}

/**
 * The plain line a chat failure shows (#263): what happened, and what to do next.
 * A model error the provider adapter has not classified yet is read the same way it is in
 * the stages, so a rejected key or a rate limit names itself.
 */
export function chatFailureMessage(err: unknown): string {
  const classified =
    err instanceof Error && !(err instanceof DomainError)
      ? classifyModelError(err.message)
      : err;
  if (classified instanceof RateLimitedError) {
    return "The model is rate limited. Wait a moment, then Retry.";
  }
  if (classified instanceof ModelUnavailableError) {
    switch (classified.category) {
      case "key rejected":
        return "The model rejected the API key. Check the key in Settings › Models.";
      case "rate limited":
        return "The model is rate limited. Wait a moment, then Retry.";
      case "budget reached":
        return "The model budget is used up for now. Raise it in Settings › Models, then Retry.";
      case "context too large":
        return "This chat is too long for the model. Shorten your message, then Retry.";
      case "model not found":
        return "The Builder's model isn't available from its provider. Choose another model in Settings › Models.";
      case "quota exhausted":
        return classified.retryAfterMs === undefined
          ? "The model's provider quota is used up. Choose another model in Settings › Models, or wait for it to reset."
          : `The model's provider quota is used up; it resets in ${formatApproxWait(classified.retryAfterMs)}. Choose another model in Settings › Models, or wait.`;
      case "model unavailable":
        return `Couldn't reach the model: ${classified.message}`;
    }
  }
  return UNREACHABLE_MESSAGE;
}

export async function handleTransition(
  repos: Repositories,
  id: string,
  action: "approve" | "restart" | "abort" | "requeue",
  _payload?: unknown,
): Promise<RunRecord> {
  if (action === "abort") {
    return stopRun(repos, id);
  }

  const { db } = repos;
  const runRepo = repos.runs;
  const jobRepo = repos.jobs;
  const commandRepo = repos.commands;
  const eventRepo = repos.events;

  const tx = db.transaction((): RunRecord => {
    const run = runRepo.get(id);
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
      );
      if (approval.nextStage) {
        jobRepo.createJob({ runId: id, stage: approval.nextStage });
      }
      return transitionResult.run;
    }

    if (action === "restart") {
      assertRunAction(run.status, "restart");
      // Cancel any active jobs first
      const activeJob = jobRepo.findActiveJobForRun(id);
      if (activeJob) {
        cancelAndStopActiveJob(
          jobRepo,
          commandRepo,
          id,
          activeJob,
          "Run restarted.",
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
      );
      jobRepo.createJob({ runId: id, stage: RESTART_ROUTE.nextStage });
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

      runRepo.update(id, { plan: newPlan, expectedRevision: run.revision });

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
      );

      if (
        payload?.chatNotes ||
        (payload?.failingTasks && payload.failingTasks.length > 0)
      ) {
        eventRepo.appendEvent(id, "user_feedback", {
          failingTasks: payload.failingTasks,
          notes: payload.chatNotes,
          text: `Feedback provided: ${payload.failingTasks?.length || 0} failing tasks.`,
        });
      }

      jobRepo.createJob({ runId: id, stage: REQUEUE_ROUTE.nextStage });
      return transitionResult.run;
    }

    throw new Error(`Unknown transition action: ${action}`);
  });

  return tx();
}
