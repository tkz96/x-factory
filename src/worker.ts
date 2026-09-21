// src/worker.ts — Independent Bun background worker process for durable job execution and stage orchestration.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { getActiveSession } from "./agents/pi.js";
import { getProject } from "./config.js";
import {
  type CommandRecord,
  CommandRepository,
} from "./db/command-repository.js";
import { createDatabase } from "./db/connection.js";
import { EventRepository } from "./db/event-repository.js";
import { type JobRecord, JobRepository } from "./db/job-repository.js";
import { runMigrations } from "./db/migrator.js";
import { OperationLedgerRepository } from "./db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "./db/run-repository.js";
import {
  type StageAttemptRecord,
  StageAttemptRepository,
} from "./db/stage-attempt-repository.js";
import { WorkerHeartbeatRepository } from "./db/worker-heartbeat-repository.js";
import { DeliverExecutor } from "./executors/deliver.js";
import {
  getStageExecutor,
  type StageContext,
  type StageExecutor,
  type StageResult,
} from "./executors/index.js";
import { finalizeDeliver } from "./services/deliver-service.js";
import type { Project, PullRequest, RunStatus } from "./shared/types.js";
import { canTransition } from "./state-machine.js";

export interface WorkerLogEntry {
  timestamp: string;
  worker_id: string;
  job_id?: string | undefined;
  run_id?: string | undefined;
  stage?: string | undefined;
  attempt?: number | undefined;
  duration_ms?: number | undefined;
  result:
    | "claimed"
    | "renewed"
    | "success"
    | "retry"
    | "failure"
    | "shutdown"
    | "heartbeat_lost"
    | "recovered"
    | "recovery_required"
    | "cancelled"
    | "error";
  message?: string | undefined;
  error?: string | undefined;
}

export interface WorkerOptions {
  workerId?: string | undefined;
  db?: Database | undefined;
  pollIntervalMs?: number | undefined;
  commandPollIntervalMs?: number | undefined;
  leaseDurationMs?: number | undefined;
  heartbeatIntervalMs?: number | undefined;
  shutdownTimeoutMs?: number | undefined;
  onLog?: ((entry: WorkerLogEntry) => void) | undefined;
  getStageExecutor?: ((stage: string) => StageExecutor) | undefined;
  deliverExecutor?:
    | {
        deliver?: (ctx: StageContext) => Promise<PullRequest>;
        execute?: (ctx: StageContext) => Promise<StageResult | PullRequest>;
      }
    | undefined;
}

export class Worker {
  readonly workerId: string;
  private db: Database;
  private runRepo: RunRepository;
  private jobRepo: JobRepository;
  private commandRepo: CommandRepository;
  private heartbeatRepo: WorkerHeartbeatRepository;
  private stageAttemptRepo: StageAttemptRepository;
  private operationLedgerRepo: OperationLedgerRepository;
  private eventRepo: EventRepository;
  private stageExecutorResolver: (stage: string) => StageExecutor;
  private deliverExecutor?:
    | {
        deliver?: (ctx: StageContext) => Promise<PullRequest>;
        execute?: (ctx: StageContext) => Promise<StageResult | PullRequest>;
      }
    | undefined;
  private pollIntervalMs: number;
  private commandPollIntervalMs: number;
  private leaseDurationMs: number;
  private heartbeatIntervalMs: number;
  private shutdownTimeoutMs: number;
  private onLog?: ((entry: WorkerLogEntry) => void) | undefined;
  private isRunning = false;
  private isStopping = false;
  private currentJob: JobRecord | null = null;
  private activeProcessingPromise: Promise<void> | null = null;
  private currentAbortController: AbortController | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: WorkerOptions) {
    this.workerId =
      options?.workerId || `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
    this.db = options?.db || createDatabase();
    this.runRepo = new RunRepository(this.db);
    this.jobRepo = new JobRepository(this.db);
    this.commandRepo = new CommandRepository(this.db);
    this.heartbeatRepo = new WorkerHeartbeatRepository(this.db);
    this.stageAttemptRepo = new StageAttemptRepository(this.db);
    this.eventRepo = new EventRepository(this.db);
    this.operationLedgerRepo = new OperationLedgerRepository(this.db);
    this.deliverExecutor = options?.deliverExecutor;
    this.stageExecutorResolver = options?.getStageExecutor ?? getStageExecutor;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
    this.commandPollIntervalMs = options?.commandPollIntervalMs ?? 500;
    this.leaseDurationMs = options?.leaseDurationMs ?? 30000;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 10000;
    this.shutdownTimeoutMs = options?.shutdownTimeoutMs ?? 5000;
    this.onLog = options?.onLog;
  }

  emitStructuredLog(
    entry: Omit<WorkerLogEntry, "timestamp" | "worker_id"> & {
      timestamp?: string | undefined;
      worker_id?: string | undefined;
    },
  ): WorkerLogEntry {
    const { timestamp, worker_id, ...rest } = entry;
    const fullEntry: WorkerLogEntry = {
      ...rest,
      timestamp: timestamp || new Date().toISOString(),
      worker_id: worker_id || this.workerId,
    };

    if (this.onLog) {
      try {
        this.onLog(fullEntry);
      } catch {
        // ignore subscriber errors
      }
    }

    const json = JSON.stringify(fullEntry);
    if (fullEntry.result === "failure" || fullEntry.result === "error") {
      console.error(json);
    } else {
      console.log(json);
    }

    return fullEntry;
  }

  log(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [Worker ${this.workerId}] ${message}`);
  }

  error(message: string, err?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorString =
      err instanceof Error ? err.message : err ? String(err) : undefined;
    console.error(
      `[${timestamp}] [Worker ${this.workerId}] ERROR: ${message}`,
      err || "",
    );
    this.emitStructuredLog({
      result: "error",
      message,
      error: errorString,
    });
  }

  /**
   * Recovers incomplete work from previous worker lifetimes (XFM-36, XFM-37).
   * Runs upon worker start before polling begins.
   */
  async recoverOnStartup(): Promise<{
    recoveredJobs: number;
    recoveryRequiredRuns: number;
  }> {
    let recoveredJobs = 0;
    let recoveryRequiredRuns = 0;

    const activeRuns = this.runRepo.listActive();
    if (activeRuns.length === 0) {
      return { recoveredJobs, recoveryRequiredRuns };
    }

    const now = new Date().toISOString();

    for (const run of activeRuns) {
      const activeJobs = this.jobRepo.findActiveJobsForRun(run.id);

      if (activeJobs.length === 0) {
        if (this.reclaimOrphanedRun(run)) {
          recoveryRequiredRuns++;
        }
        continue;
      }

      for (const job of activeJobs) {
        const result = this.reclaimStaleClaimedJob(run, job, now);
        if (result === "recovered") {
          recoveredJobs++;
        } else if (result === "recovery_required") {
          recoveryRequiredRuns++;
        }
      }
    }

    return { recoveredJobs, recoveryRequiredRuns };
  }

  private reclaimOrphanedRun(run: RunRecord): boolean {
    if (run.status === "ready_for_pr") {
      return false;
    }

    this.emitStructuredLog({
      result: "recovery_required",
      run_id: run.id,
      message: `Active run ${run.id} in status "${run.status}" has no pending or claimed jobs. Transitioning to recovery_required.`,
    });

    try {
      this.runRepo.transitionRun(run.id, run.status, "recovery_required", {
        event: {
          type: "status",
          payload: {
            status: "recovery_required",
            reason:
              "Active run found without any pending or claimed workflow jobs on worker startup.",
          },
        },
      });
      return true;
    } catch (err: unknown) {
      this.error(
        `Failed to transition orphaned run ${run.id} to recovery_required:`,
        err,
      );
      return false;
    }
  }

  private reclaimStaleClaimedJob(
    run: RunRecord,
    job: JobRecord,
    now: string,
  ): "recovered" | "recovery_required" | null {
    if (job.status !== "claimed" || !job.leaseUntil || job.leaseUntil >= now) {
      return null;
    }

    if (job.attempts >= job.maxAttempts) {
      this.emitStructuredLog({
        result: "recovery_required",
        run_id: run.id,
        job_id: job.id,
        stage: job.stage,
        attempt: job.attempts,
        message: `Job ${job.id} for run ${run.id} exhausted maximum attempts (${job.attempts}/${job.maxAttempts}). Transitioning run to recovery_required.`,
      });

      this.jobRepo.failJob(
        job.id,
        this.workerId,
        "Maximum retry attempts exhausted across worker lifetimes.",
        0,
      );
      try {
        this.runRepo.transitionRun(run.id, run.status, "recovery_required", {
          event: {
            type: "status",
            payload: {
              status: "recovery_required",
              reason: `Job attempts (${job.attempts}/${job.maxAttempts}) exhausted for stage ${job.stage}.`,
            },
          },
        });
        return "recovery_required";
      } catch (err: unknown) {
        this.error(
          `Failed to transition run ${run.id} to recovery_required:`,
          err,
        );
        return null;
      }
    }

    const latestAttempt = this.stageAttemptRepo.getLatestAttempt(
      run.id,
      job.stage,
    );
    if (latestAttempt && latestAttempt.status === "running") {
      this.stageAttemptRepo.recordFailure(
        latestAttempt.id,
        "Worker process terminated during execution.",
      );
    }

    const requeued = this.jobRepo.requeueJob(job.id);
    if (requeued) {
      this.emitStructuredLog({
        result: "recovered",
        run_id: run.id,
        job_id: job.id,
        stage: job.stage,
        attempt: job.attempts,
        message: `Recovered stale claimed job ${job.id} for run ${run.id} (stage: ${job.stage}). Re-queued for execution.`,
      });
      return "recovered";
    }

    return null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isStopping = false;

    // Validate database and run migrations before accepting any work
    try {
      const migrationResult = runMigrations(this.db);
      this.log(
        `Database verified at schema version ${migrationResult.currentVersion} (${migrationResult.applied} migration(s) applied).`,
      );
    } catch (err: unknown) {
      this.error("Database migration check failed. Halting worker.", err);
      throw err;
    }

    // Register worker heartbeat in SQLite after migrations succeed (Phase 3, Section 47)
    this.heartbeatRepo.upsert(this.workerId, process.pid, os.hostname());

    // Startup recovery for incomplete work / dead workers (XFM-36, XFM-37)
    try {
      const recovery = await this.recoverOnStartup();
      if (recovery.recoveredJobs > 0 || recovery.recoveryRequiredRuns > 0) {
        this.log(
          `Startup recovery completed: ${recovery.recoveredJobs} job(s) re-queued, ${recovery.recoveryRequiredRuns} run(s) transitioned to recovery_required.`,
        );
      }
    } catch (err: unknown) {
      this.error("Startup recovery error:", err);
    }

    this.log("Worker started. Polling for pending jobs and commands...");
    this.pollLoop();
    this.commandPollingLoop();
  }

  async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    this.isRunning = false;
    this.log("Stopping worker cleanly...");
    this.stopHeartbeat();

    // Signal cancellation to any actively executing stage
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    // If an active job is processing, wait up to shutdownTimeoutMs for clean completion
    if (this.activeProcessingPromise) {
      this.log(
        `Waiting up to ${this.shutdownTimeoutMs}ms for in-flight job to finish...`,
      );
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, this.shutdownTimeoutMs),
      );
      await Promise.race([this.activeProcessingPromise, timeout]).catch(
        () => {},
      );
    }

    if (this.currentJob) {
      this.log(
        `Releasing lease for active job ${this.currentJob.id} during shutdown...`,
      );
      try {
        this.jobRepo.releaseLease(this.currentJob.id, this.workerId);
      } catch (err: unknown) {
        this.error("Failed to release lease during shutdown", err);
      }
      this.currentJob = null;
    }

    this.emitStructuredLog({
      result: "shutdown",
      message: "Worker stopped cleanly",
    });

    try {
      this.heartbeatRepo.remove(this.workerId);
    } catch {
      // ignore errors during shutdown
    }

    this.log("Worker stopped.");
  }

  private startHeartbeat(jobId: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try {
        // Renew worker heartbeat in SQLite
        this.heartbeatRepo.upsert(this.workerId, process.pid, os.hostname());

        const ok = this.jobRepo.renewLease(
          jobId,
          this.workerId,
          this.leaseDurationMs,
        );
        if (!ok) {
          this.emitStructuredLog({
            job_id: jobId,
            result: "heartbeat_lost",
            message: `Heartbeat lease renewal failed for job ${jobId}. Worker may have lost lease.`,
          });
        } else {
          this.emitStructuredLog({
            job_id: jobId,
            result: "renewed",
            message: "Worker lease renewed successfully",
          });
        }
      } catch (err: unknown) {
        this.error(`Heartbeat error renewing lease for job ${jobId}`, err);
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Command polling loop running concurrently with job execution (Phase 1, Section 10, 17, 23, 48).
   */
  private async commandPollingLoop(): Promise<void> {
    while (this.isRunning && !this.isStopping) {
      try {
        const commands = this.commandRepo.claimPendingCommands(
          this.workerId,
          this.leaseDurationMs,
        );

        for (const command of commands) {
          await this.processCommand(command);
        }
      } catch (err: unknown) {
        this.error("Unexpected error in worker command loop", err);
      }

      await new Promise((r) => setTimeout(r, this.commandPollIntervalMs));
    }
  }

  async processCommand(command: CommandRecord): Promise<void> {
    if (command.targetWorkerId && command.targetWorkerId !== this.workerId) {
      const isTargetAlive = this.heartbeatRepo.isWorkerActive(
        command.targetWorkerId,
        30000,
      );
      if (!isTargetAlive) {
        if (command.command === "stop") {
          this.commandRepo.completeCommand(command.id, {
            stopped: true,
            reason: `Target worker ${command.targetWorkerId} is dead or inactive; run already stopped`,
          });
          return;
        }
        if (command.command === "steer") {
          this.commandRepo.failCommand(
            command.id,
            `Target worker ${command.targetWorkerId} is dead or inactive`,
          );
          return;
        }
      }
    }

    if (command.command === "stop") {
      const payload = command.payload as { jobId?: string } | null;
      const targetJobId = payload?.jobId;

      if (
        this.currentJob &&
        this.currentJob.id === targetJobId &&
        this.currentJob.runId === command.runId
      ) {
        this.log(
          `Aborting active job ${targetJobId} for run ${command.runId} due to targeted stop command`,
        );
        this.currentAbortController?.abort();
      }

      this.commandRepo.completeCommand(command.id, { stopped: true });
    } else if (command.command === "steer") {
      const payload = command.payload as { message?: string } | null;
      const message = payload?.message || "";

      // 1. Mark command completed before invocation (at-most-once)
      this.commandRepo.completeCommand(command.id, { steered: true });

      // 2. Find active Pi session
      const session = getActiveSession(command.runId);
      if (session) {
        try {
          await session.steer(message);
        } catch (err) {
          this.error(`Error steering Pi session for run ${command.runId}`, err);
        }
      } else {
        this.log(
          `No active Pi session found for steer command on run ${command.runId}`,
        );
      }
    } else if (command.command === "deliver") {
      await this.processDeliverCommand(command);
    }
  }

  private async processDeliverCommand(command: CommandRecord): Promise<void> {
    const run = this.runRepo.get(command.runId);
    if (!run) {
      this.commandRepo.failCommand(
        command.id,
        `Run ${command.runId} not found`,
      );
      return;
    }

    if (run.status !== "ready_for_pr") {
      this.commandRepo.failCommand(
        command.id,
        `Cannot deliver run ${command.runId} in status "${run.status}". Must be ready_for_pr.`,
      );
      return;
    }

    const project = await this.resolveProject(run);

    const dummyJob: JobRecord = {
      id: `cmd-job-${command.id}`,
      runId: run.id,
      stage: "deliver",
      status: "claimed",
      workerId: this.workerId,
      attempts: 1,
      maxAttempts: 3,
      availableAt: new Date().toISOString(),
      leaseUntil: new Date(Date.now() + 60000).toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const attempt = this.stageAttemptRepo.recordStart(run.id, "deliver", 1);

    try {
      const deliverExecutor = this.deliverExecutor ?? new DeliverExecutor();
      const stageCtx = {
        run,
        job: dummyJob,
        project,
        workerId: this.workerId,
        db: this.db,
        runRepo: this.runRepo,
        jobRepo: this.jobRepo,
        eventRepo: this.eventRepo,
        stageAttemptRepo: this.stageAttemptRepo,
        operationLedgerRepo: this.operationLedgerRepo,
        attemptId: attempt.id,
      };
      let pr: PullRequest;
      if (deliverExecutor.deliver) {
        pr = await deliverExecutor.deliver(stageCtx);
      } else if (deliverExecutor.execute) {
        const res = await deliverExecutor.execute(stageCtx);
        if ("url" in res && typeof (res as PullRequest).url === "string") {
          pr = res as PullRequest;
        } else if (
          (res as StageResult).status === "success" &&
          (res as StageResult).output
        ) {
          pr = (res as StageResult).output as PullRequest;
        } else {
          throw new Error(
            (res as StageResult).error || "Deliver failed without output",
          );
        }
      } else {
        throw new Error("No deliver executor available");
      }

      finalizeDeliver(
        this.db,
        this.runRepo,
        this.eventRepo,
        this.commandRepo,
        run.id,
        command.id,
        this.workerId,
        pr,
      );

      this.stageAttemptRepo.recordCompletion(attempt.id, {
        ok: true,
        output: pr,
      });

      this.log(
        `Deliver command ${command.id} completed successfully for run ${run.id}: ${pr.url}`,
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.stageAttemptRepo.recordCompletion(attempt.id, {
        ok: false,
        error: errorMsg,
      });
      this.error(`Deliver command ${command.id} failed: ${errorMsg}`, err);
      this.commandRepo.failCommand(command.id, errorMsg);
    }
  }

  /**
   * Claims and executes exactly one pending/claimed job if available,
   * managing heartbeat renewal and error handling.
   * Returns the processed JobRecord, or null if no job was claimed.
   */
  async stepOnce(): Promise<JobRecord | null> {
    this.heartbeatRepo.upsert(this.workerId, process.pid, os.hostname());
    const job = this.jobRepo.claimNextJob(this.workerId, this.leaseDurationMs);

    if (!job) {
      return null;
    }

    this.currentJob = job;
    this.emitStructuredLog({
      job_id: job.id,
      run_id: job.runId,
      stage: job.stage,
      attempt: job.attempts,
      result: "claimed",
      message: `Job claimed by worker ${this.workerId}`,
    });

    this.startHeartbeat(job.id);
    const processPromise = this.processJob(job);
    this.activeProcessingPromise = processPromise;
    try {
      await processPromise;
      return job;
    } finally {
      this.activeProcessingPromise = null;
      this.stopHeartbeat();
      this.currentJob = null;
    }
  }

  /**
   * Claims and executes the next pending job for a specific run.
   * Returns the processed JobRecord, or null if no job was available for the run.
   */
  async stepRun(runId: string): Promise<JobRecord | null> {
    this.heartbeatRepo.upsert(this.workerId, process.pid, os.hostname());
    const job = this.jobRepo.claimJobForRun(
      runId,
      this.workerId,
      this.leaseDurationMs,
    );

    if (!job) {
      return null;
    }

    this.currentJob = job;
    this.emitStructuredLog({
      job_id: job.id,
      run_id: job.runId,
      stage: job.stage,
      attempt: job.attempts,
      result: "claimed",
      message: `Job claimed by worker ${this.workerId}`,
    });

    this.startHeartbeat(job.id);
    const processPromise = this.processJob(job);
    this.activeProcessingPromise = processPromise;
    try {
      await processPromise;
      return job;
    } finally {
      this.activeProcessingPromise = null;
      this.stopHeartbeat();
      this.currentJob = null;
    }
  }

  /**
   * Claims and processes pending commands (such as deliver or stop) if available.
   * Returns the processed CommandRecord array.
   */
  async stepCommandOnce(): Promise<CommandRecord[]> {
    const commands = this.commandRepo.claimPendingCommands(
      this.workerId,
      this.leaseDurationMs,
    );

    for (const command of commands) {
      await this.processCommand(command);
    }
    return commands;
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning && !this.isStopping) {
      try {
        this.heartbeatRepo.upsert(this.workerId, process.pid, os.hostname());
        const job = this.jobRepo.claimNextJob(
          this.workerId,
          this.leaseDurationMs,
        );

        if (job) {
          this.currentJob = job;
          this.emitStructuredLog({
            job_id: job.id,
            run_id: job.runId,
            stage: job.stage,
            attempt: job.attempts,
            result: "claimed",
            message: `Job claimed by worker ${this.workerId}`,
          });

          this.startHeartbeat(job.id);
          const processPromise = this.processJob(job);
          this.activeProcessingPromise = processPromise;
          try {
            await processPromise;
          } finally {
            this.activeProcessingPromise = null;
            this.stopHeartbeat();
            this.currentJob = null;
          }
        } else {
          // No job ready; sleep for pollInterval
          await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        }
      } catch (err: unknown) {
        this.error("Unexpected error in worker poll loop", err);
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    }
  }

  private async resolveProject(run: RunRecord): Promise<Project> {
    try {
      const project = await getProject(run.project.id);
      if (project) return project;
    } catch {
      // Fallback below
    }

    return {
      id: run.project.id,
      name: run.project.name,
      workspacePath: run.worktreePath || run.artifactsDir,
      repositoryPath: run.worktreePath || run.artifactsDir,
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [],
      issueTracker: {
        provider: "jira",
      },
    };
  }

  private checkAndHandleCancellation(
    job: JobRecord,
    attemptId: string,
    startTime: number,
  ): boolean {
    const currentRun = this.runRepo.get(job.runId);
    const currentJob = this.jobRepo.getJob(job.id);
    if (
      currentRun?.status === "stopped" ||
      currentJob?.status === "cancelled"
    ) {
      const duration = Math.round(performance.now() - startTime);
      this.stageAttemptRepo.recordCancellation(
        attemptId,
        "Run stopped by operator during stage execution",
      );
      this.emitStructuredLog({
        job_id: job.id,
        run_id: job.runId,
        stage: job.stage,
        attempt: job.attempts,
        duration_ms: duration,
        result: "cancelled",
        message: `Stage '${job.stage}' cancelled due to run stop.`,
      });
      return true;
    }
    return false;
  }

  /**
   * Executes a claimed job using discrete stage executors and atomic SQLite transactions (XFM-28, XFM-29, XFM-30, XFM-31).
   */
  async processJob(job: JobRecord): Promise<void> {
    const startTime = performance.now();
    this.log(
      `Job started: job_id=${job.id} run_id=${job.runId} stage=${job.stage}`,
    );

    // Section 12: Early Cancellation Gate
    const run = this.runRepo.get(job.runId);
    const freshJob = this.jobRepo.getJob(job.id);
    if (
      !run ||
      run.status === "stopped" ||
      !freshJob ||
      freshJob.status === "cancelled"
    ) {
      this.log(
        `Job ${job.id} skipped due to early cancellation: run status is ${run?.status}, job status is ${freshJob?.status}`,
      );
      return;
    }

    // Load project configuration
    const project = await this.resolveProject(run);

    // Durably record stage attempt start in SQLite (XFM-29)
    const attempt = this.stageAttemptRepo.recordStart(
      run.id,
      job.stage,
      job.attempts,
    );

    this.currentAbortController = new AbortController();

    try {
      const executor = this.stageExecutorResolver(job.stage);

      // Execute isolated stage
      const result = await executor.execute({
        run,
        job,
        project,
        workerId: this.workerId,
        db: this.db,
        runRepo: this.runRepo,
        jobRepo: this.jobRepo,
        eventRepo: this.eventRepo,
        stageAttemptRepo: this.stageAttemptRepo,
        operationLedgerRepo: this.operationLedgerRepo,
        attemptId: attempt.id,
        signal: this.currentAbortController.signal,
      });

      if (this.isStopping) return;

      // Section 13: Re-read state after executor completion to catch mid-flight stops
      if (this.checkAndHandleCancellation(job, attempt.id, startTime)) {
        return;
      }

      const duration = Math.round(performance.now() - startTime);

      if (result.status === "success" || result.status === "retry") {
        this.commitStageProgression(job, attempt, result, duration, run.status);
      } else {
        const errorMsg = result.error || `Stage '${job.stage}' failed`;
        this.handleStageFailure(job, run, attempt.id, errorMsg, duration);
      }
    } catch (err: unknown) {
      if (this.isStopping) return;

      // Section 13: Re-read state in catch handler to catch mid-flight stops
      if (this.checkAndHandleCancellation(job, attempt.id, startTime)) {
        return;
      }

      const duration = Math.round(performance.now() - startTime);
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.handleStageFailure(job, run, attempt.id, errorMsg, duration);
    } finally {
      this.currentAbortController = null;
    }
  }

  private commitStageProgression(
    job: JobRecord,
    attempt: StageAttemptRecord,
    result: StageResult,
    duration: number,
    expectedRunStatus: RunStatus,
  ): boolean {
    const isRetry = result.status === "retry";
    const transitionText = isRetry
      ? `Stage '${job.stage}' requested retry: transitioning to '${result.nextRunStatus}'.`
      : `Stage '${job.stage}' completed. Transitioning to '${result.nextRunStatus}'.`;

    const committed = this.db.transaction(() => {
      // Section 11: Worker Progression CAS verification
      const j = this.jobRepo.getJob(job.id, this.db);
      const r = this.runRepo.get(job.runId, this.db);

      if (
        j?.status !== "claimed" ||
        j?.workerId !== this.workerId ||
        r?.status !== expectedRunStatus
      ) {
        return false;
      }

      this.stageAttemptRepo.recordCompletion(
        attempt.id,
        result.output,
        this.db,
      );

      if (result.nextRunStatus) {
        if (r.status !== result.nextRunStatus) {
          this.runRepo.transitionRun(
            job.runId,
            r.status,
            result.nextRunStatus,
            {
              event: {
                type: "status",
                payload: {
                  status: result.nextRunStatus,
                  text: transitionText,
                },
              },
            },
            this.db,
          );
        }
      }

      // Section 15: If nextStage is specified, enqueue next job.
      // If nextRunStatus is ready_for_pr and nextStage is undefined, no next job is created.
      if (result.nextStage) {
        this.jobRepo.createJob(
          {
            runId: job.runId,
            stage: result.nextStage,
            status: "pending",
          },
          this.db,
        );
      }

      this.jobRepo.completeJob(job.id, this.workerId, this.db);
      return true;
    })();

    if (!committed) {
      this.log(
        `Progression CAS check failed for job ${job.id} on run ${job.runId}. Stage progression aborted.`,
      );
      return false;
    }

    if (isRetry) {
      this.emitStructuredLog({
        job_id: job.id,
        run_id: job.runId,
        stage: job.stage,
        attempt: job.attempts,
        duration_ms: duration,
        result: "retry",
        message: `Stage '${job.stage}' requested retry to '${result.nextStage}'`,
      });
      this.log(
        `Stage '${job.stage}' routed to retry '${result.nextStage}': job_id=${job.id}`,
      );
    } else {
      this.emitStructuredLog({
        job_id: job.id,
        run_id: job.runId,
        stage: job.stage,
        attempt: job.attempts,
        duration_ms: duration,
        result: "success",
        message: `Stage '${job.stage}' completed successfully`,
      });
      this.log(
        `Job completed successfully: job_id=${job.id}, stage=${job.stage}`,
      );
    }

    return true;
  }

  private handleStageFailure(
    job: JobRecord,
    run: RunRecord,
    attemptId: string,
    errorMsg: string,
    durationMs: number,
  ): void {
    this.error(`Stage '${job.stage}' execution failed: ${errorMsg}`);

    // Record failure in stage_attempts (XFM-29)
    try {
      this.stageAttemptRepo.recordFailure(attemptId, errorMsg);
    } catch (e: unknown) {
      this.error("Failed to record stage attempt failure", e);
    }

    // Fail job in job repository with bounded retries
    const retryStatus = this.jobRepo.failJob(job.id, this.workerId, errorMsg);

    if (retryStatus.willRetry) {
      this.emitStructuredLog({
        job_id: job.id,
        run_id: job.runId,
        stage: job.stage,
        attempt: retryStatus.attempts,
        duration_ms: durationMs,
        result: "retry",
        message: `Job scheduled for retry (${retryStatus.attempts}/${job.maxAttempts})`,
        error: errorMsg,
      });
      this.log(
        `Job scheduled for retry (attempt ${retryStatus.attempts}/${job.maxAttempts}): job_id=${job.id}`,
      );
    } else {
      this.emitStructuredLog({
        job_id: job.id,
        run_id: job.runId,
        stage: job.stage,
        attempt: retryStatus.attempts,
        duration_ms: durationMs,
        result: "failure",
        message: `Job entered terminal failure (exhausted ${retryStatus.attempts} attempts)`,
        error: errorMsg,
      });
      this.log(
        `Job entered terminal failure (exhausted ${retryStatus.attempts} attempts): job_id=${job.id}`,
      );

      // Transition run to failed if allowed by FSM
      try {
        const latestRun = this.runRepo.get(run.id);
        if (latestRun && canTransition(latestRun.status, "failed")) {
          this.runRepo.transitionRun(run.id, latestRun.status, "failed", {
            event: {
              type: "status",
              payload: {
                status: "failed",
                text: `Run failed during stage '${job.stage}': ${errorMsg}`,
              },
            },
          });
        }
      } catch (err: unknown) {
        this.error(`Failed to transition run ${run.id} to failed`, err);
      }
    }
  }
}

// Direct executable process entry point
if (import.meta.main) {
  const worker = new Worker();

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully stopping worker...`);
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  worker.start().catch((err) => {
    console.error("Fatal worker failure:", err);
    process.exit(1);
  });
}
