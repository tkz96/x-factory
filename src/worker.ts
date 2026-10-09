// src/worker.ts — Independent Bun background worker process for durable job execution and stage orchestration.

import { bootstrapLLMEnv } from "./env-bootstrap.js";

bootstrapLLMEnv();

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createRepositories, openProcessDatabase } from "./composition-root.js";
import { getProject } from "./config.js";
import type { CommandRecord } from "./db/command-repository.js";
import type { JobRecord, JobRepository } from "./db/job-repository.js";
import { runMigrations } from "./db/migrator.js";
import type { RunRecord, RunRepository } from "./db/run-repository.js";
import type { WorkerHeartbeatRepository } from "./db/worker-heartbeat-repository.js";
import { DeliverExecutor } from "./executors/deliver.js";
import { getStageExecutor, type StageExecutor } from "./executors/index.js";
import {
  type Clock,
  LeaseManager,
  type LeasePolicy,
  type WorkerLogRecord,
} from "./lease.js";
import { ProviderError } from "./providers/errors.js";
import { AWAITING_HUMAN_RUN_STATUSES } from "./shared/run-status-policy.js";
import type { Project } from "./shared/types.js";
import {
  deliverCommandWork,
  jobWork,
  StageRunner,
  type StageRunnerHost,
} from "./stage-runner.js";

export type WorkerLogEntry = WorkerLogRecord;

export interface WorkerOptions {
  workerId?: string | undefined;
  db?: Database | undefined;
  clock?: Clock | undefined;
  leasePolicy?: Partial<LeasePolicy> | undefined;
  pollIntervalMs?: number | undefined;
  commandPollIntervalMs?: number | undefined;
  leaseDurationMs?: number | undefined;
  commandLeaseDurationMs?: number | undefined;
  heartbeatIntervalMs?: number | undefined;
  commandHeartbeatIntervalMs?: number | undefined;
  shutdownTimeoutMs?: number | undefined;
  onLog?: ((entry: WorkerLogEntry) => void) | undefined;
  getStageExecutor?: ((stage: string) => StageExecutor) | undefined;
  deliverExecutor?: StageExecutor | undefined;
}

/**
 * What to print for an error. A ProviderError's `cause` is the raw provider
 * failure and printing the object prints it too, so only its canonical message
 * is logged.
 */
export function loggableError(err: unknown): unknown {
  if (err instanceof ProviderError) return err.message;
  return err || "";
}

export class Worker {
  readonly workerId: string;
  private db: Database;
  /** True when the worker opened its own connection and so closes it on stop. */
  private ownsDb: boolean;
  private runRepo: RunRepository;
  private jobRepo: JobRepository;
  private heartbeatRepo: WorkerHeartbeatRepository;
  private stageRunner: StageRunner;
  private runnerHost: StageRunnerHost;
  private leaseManager: LeaseManager;
  private policy: LeasePolicy;
  private stageExecutorResolver: (stage: string) => StageExecutor;
  private deliverExecutor?: StageExecutor | undefined;
  private pollIntervalMs: number;
  private commandPollIntervalMs: number;
  private shutdownTimeoutMs: number;
  private onLog?: ((entry: WorkerLogEntry) => void) | undefined;
  private isRunning = false;
  private isStopping = false;
  private currentJob: JobRecord | null = null;
  private activeProcessingPromise: Promise<void> | null = null;
  private currentAbortController: AbortController | null = null;
  private commandAbortController: AbortController | null = null;

  constructor(options?: WorkerOptions) {
    this.workerId =
      options?.workerId || `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
    this.ownsDb = !options?.db;
    this.db = options?.db ?? openProcessDatabase();
    const repos = createRepositories(this.db);
    this.runRepo = repos.runs;
    this.jobRepo = repos.jobs;
    this.heartbeatRepo = repos.heartbeats;
    this.deliverExecutor = options?.deliverExecutor;
    this.stageExecutorResolver = options?.getStageExecutor ?? getStageExecutor;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
    this.commandPollIntervalMs = options?.commandPollIntervalMs ?? 500;
    this.shutdownTimeoutMs = options?.shutdownTimeoutMs ?? 5000;
    this.onLog = options?.onLog;

    this.leaseManager = new LeaseManager(repos, {
      clock: options?.clock,
      policy: {
        ...options?.leasePolicy,
        jobLeaseTtlMs:
          options?.leaseDurationMs ?? options?.leasePolicy?.jobLeaseTtlMs,
        commandLeaseTtlMs:
          options?.commandLeaseDurationMs ??
          options?.leasePolicy?.commandLeaseTtlMs,
        heartbeatIntervalMs:
          options?.heartbeatIntervalMs ??
          options?.leasePolicy?.heartbeatIntervalMs,
        commandHeartbeatIntervalMs:
          options?.commandHeartbeatIntervalMs ??
          options?.leasePolicy?.commandHeartbeatIntervalMs,
      },
      onLog: (entry) => this.emitStructuredLog(entry),
    });
    this.policy = this.leaseManager.policy;

    this.runnerHost = {
      workerId: this.workerId,
      repos,
      leases: this.leaseManager,
      resolveProject: async (runId) => {
        const run = this.runRepo.get(runId);
        if (!run) throw new Error(`Run ${runId} not found`);
        return this.resolveProject(run);
      },
      upsertHeartbeat: () => this.upsertHeartbeat(),
      isShuttingDown: () => this.isStopping,
      log: (message) => this.log(message),
      error: (message, err) => this.error(message, err),
      emitLog: (entry) => this.emitStructuredLog(entry),
    };
    this.stageRunner = new StageRunner(this.runnerHost);
  }

  private upsertHeartbeat(): void {
    const now = this.leaseManager.nowIso();
    // started_at is written on insert only (the upsert keeps it on conflict),
    // so passing it on every beat is harmless.
    this.heartbeatRepo.upsert({
      workerId: this.workerId,
      pid: process.pid,
      hostname: os.hostname(),
      lastHeartbeat: now,
      startedAt: now,
    });
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
      timestamp: timestamp || this.leaseManager.nowIso(),
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
      loggableError(err),
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
    // Stale claimed jobs go through the lease module: it closes the attempt,
    // exhausts to recovery_required or requeues, all with the injected clock.
    const swept = this.leaseManager.recoverStaleJobs();
    const recoveredJobs = swept.recoveredCount;
    let recoveryRequiredRuns = swept.recoveryRequiredCount;

    for (const run of this.runRepo.listActive()) {
      if (
        this.jobRepo.findActiveJobsForRun(run.id).length === 0 &&
        this.reclaimOrphanedRun(run)
      ) {
        recoveryRequiredRuns++;
      }
    }

    return { recoveredJobs, recoveryRequiredRuns };
  }

  private reclaimOrphanedRun(run: RunRecord): boolean {
    if (AWAITING_HUMAN_RUN_STATUSES.has(run.status)) {
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
    this.upsertHeartbeat();

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

    // Signal cancellation to any actively executing stage
    this.currentAbortController?.abort();
    this.commandAbortController?.abort();

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
        this.leaseManager.releaseJobLease(this.currentJob.id, this.workerId);
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

    if (this.ownsDb) {
      try {
        this.db.close();
      } catch {
        // Ignore if already closed
      }
    }

    this.log("Worker stopped.");
  }

  /**
   * Command polling loop running concurrently with job execution (Phase 1, Section 10, 17, 23, 48).
   */
  private async commandPollingLoop(): Promise<void> {
    while (this.isRunning && !this.isStopping) {
      try {
        const commands = this.leaseManager.claimCommands(
          this.workerId,
          this.policy.commandLeaseTtlMs,
          this.policy.heartbeatTtlMs,
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

      this.leaseManager.completeCommand(command.id, this.workerId, {
        stopped: true,
      });
    } else if (command.command === "deliver") {
      await this.processDeliverCommand(command);
    } else {
      // Leftover command rows from versions that still had steering (#167)
      // are failed instead of crashing or silently retried.
      this.leaseManager.failCommand(
        command.id,
        this.workerId,
        `Unsupported command type "${command.command}"`,
      );
    }
  }

  private async processDeliverCommand(command: CommandRecord): Promise<void> {
    const run = this.runRepo.get(command.runId);
    if (!run) {
      this.leaseManager.failCommand(
        command.id,
        this.workerId,
        `Run ${command.runId} not found`,
      );
      return;
    }

    if (run.status !== "ready_for_pr") {
      this.leaseManager.failCommand(
        command.id,
        this.workerId,
        `Cannot deliver run ${command.runId} in status "${run.status}". Must be ready_for_pr.`,
      );
      return;
    }

    const work = deliverCommandWork(
      command,
      this.runnerHost,
      this.policy.commandLeaseTtlMs,
      this.policy.commandHeartbeatIntervalMs,
    );
    this.commandAbortController = new AbortController();
    try {
      await this.stageRunner.run(
        work,
        this.deliverExecutor ?? new DeliverExecutor(),
        this.commandAbortController.signal,
      );
    } finally {
      this.commandAbortController = null;
    }
  }

  /**
   * Claims and executes exactly one pending/claimed job if available,
   * managing heartbeat renewal and error handling.
   * Returns the processed JobRecord, or null if no job was claimed.
   */
  async stepOnce(): Promise<JobRecord | null> {
    this.upsertHeartbeat();
    const job = this.leaseManager.claimNextJob(
      this.workerId,
      this.policy.jobLeaseTtlMs,
    );

    if (!job) {
      return null;
    }

    await this.runClaimedJob(job);
    return job;
  }

  /** Logs the claim and runs the job through the stage runner, tracking it for stop and shutdown. */
  private async runClaimedJob(job: JobRecord): Promise<void> {
    this.currentJob = job;
    this.emitStructuredLog({
      job_id: job.id,
      run_id: job.runId,
      stage: job.stage,
      attempt: job.attempts,
      result: "claimed",
      message: `Job claimed by worker ${this.workerId}`,
    });

    const processPromise = this.processJob(job);
    this.activeProcessingPromise = processPromise;
    try {
      await processPromise;
    } finally {
      this.activeProcessingPromise = null;
      this.currentJob = null;
    }
  }

  /**
   * Claims and executes the next pending job for a specific run.
   * Returns the processed JobRecord, or null if no job was available for the run.
   */
  async stepRun(runId: string): Promise<JobRecord | null> {
    this.upsertHeartbeat();
    const job = this.leaseManager.claimJobForRun(
      runId,
      this.workerId,
      this.policy.jobLeaseTtlMs,
    );

    if (!job) {
      return null;
    }

    await this.runClaimedJob(job);
    return job;
  }

  /**
   * Claims and processes pending commands (such as deliver or stop) if available.
   * Returns the processed CommandRecord array.
   */
  async stepCommandOnce(): Promise<CommandRecord[]> {
    const commands = this.leaseManager.claimCommands(
      this.workerId,
      this.policy.commandLeaseTtlMs,
      this.policy.heartbeatTtlMs,
    );

    for (const command of commands) {
      await this.processCommand(command);
    }
    return commands;
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning && !this.isStopping) {
      try {
        this.upsertHeartbeat();
        const job = this.leaseManager.claimNextJob(
          this.workerId,
          this.policy.jobLeaseTtlMs,
        );

        if (job) {
          await this.runClaimedJob(job);
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

  /**
   * Runs a claimed job through the stage runner: claim, attempt, heartbeat, execute,
   * cancellation re-check, then output and transition committed atomically (#190).
   */
  async processJob(job: JobRecord): Promise<void> {
    this.currentAbortController = new AbortController();
    try {
      await this.stageRunner.run(
        jobWork(
          job,
          this.runnerHost,
          this.policy.jobLeaseTtlMs,
          this.policy.heartbeatIntervalMs,
        ),
        this.stageExecutorResolver(job.stage),
        this.currentAbortController.signal,
      );
    } finally {
      this.currentAbortController = null;
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
    console.error("Fatal worker failure:", loggableError(err));
    process.exit(1);
  });
}
