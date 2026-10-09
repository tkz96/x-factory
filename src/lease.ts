// src/lease.ts — Lease module for background jobs and operator commands (#180).
//
// Owns claim, renew, release, expire and exhaust for both jobs and commands,
// with timeouts as policy and an injected clock.

import type { Repositories } from "./composition-root.js";
import type { CommandRecord } from "./db/command-repository.js";
import type { JobRecord } from "./db/job-repository.js";
import type { WorkerHeartbeatRecord } from "./db/worker-heartbeat-repository.js";
import { canTransition } from "./shared/run-status-policy.js";

export interface LeasePolicy {
  readonly jobLeaseTtlMs: number;
  readonly commandLeaseTtlMs: number;
  readonly heartbeatIntervalMs: number;
  readonly commandHeartbeatIntervalMs: number;
  readonly heartbeatTtlMs: number;
}

export const DEFAULT_LEASE_POLICY: LeasePolicy = {
  jobLeaseTtlMs: 30_000,
  commandLeaseTtlMs: 300_000,
  heartbeatIntervalMs: 10_000,
  commandHeartbeatIntervalMs: 100_000,
  heartbeatTtlMs: 30_000,
};

export interface Clock {
  now(): number;
}

/** One structured log entry shape, shared by the lease module and the worker. */
export interface StructuredLogEntry {
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

/** What the lease module reports: the worker adds the timestamp and its id. */
export type LeaseStructuredLogEntry = Omit<
  StructuredLogEntry,
  "timestamp" | "worker_id"
>;

/** The one reason recorded on a stage attempt closed because its lease expired. */
const LEASE_EXPIRED_REASON =
  "Worker lease expired; Worker process terminated during execution.";

export interface LeaseManagerOptions {
  clock?: Clock | undefined;
  policy?:
    | { [K in keyof LeasePolicy]?: LeasePolicy[K] | undefined }
    | undefined;
  onLog?: ((entry: LeaseStructuredLogEntry) => void) | undefined;
}

export interface ExpireJobsResult {
  expiredCount: number;
  recoveryRequiredCount: number;
}

export interface RecoverJobsResult extends ExpireJobsResult {
  recoveredCount: number;
}

export interface ExpireCommandsResult {
  expiredCount: number;
}

function definedEntries<T extends object>(value: Partial<T> | undefined) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export class LeaseManager {
  private repos: Repositories;
  private clock?: Clock | undefined;
  readonly policy: LeasePolicy;
  private onLog?: ((entry: LeaseStructuredLogEntry) => void) | undefined;

  constructor(repos: Repositories, options?: LeaseManagerOptions) {
    this.repos = repos;
    this.clock = options?.clock;
    const overrides = definedEntries<LeasePolicy>(
      options?.policy as Partial<LeasePolicy>,
    );
    this.policy = {
      ...DEFAULT_LEASE_POLICY,
      // A command heartbeat that is not set follows its lease: a third of it.
      ...(overrides.commandLeaseTtlMs !== undefined &&
      overrides.commandHeartbeatIntervalMs === undefined
        ? {
            commandHeartbeatIntervalMs: Math.floor(
              overrides.commandLeaseTtlMs / 3,
            ),
          }
        : {}),
      ...overrides,
    };
    this.onLog = options?.onLog;
  }

  nowMs(): number {
    return this.clock ? this.clock.now() : Date.now();
  }

  nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private emitLog(entry: LeaseStructuredLogEntry): void {
    if (this.onLog) {
      try {
        this.onLog(entry);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  /**
   * Closes any currently running stage attempt for a run and stage because its
   * lease expired. Returns true when an attempt was closed.
   */
  private closeRunningStageAttempt(
    runId: string,
    stage: string,
    now: string,
  ): boolean {
    const latestAttempt = this.repos.stageAttempts.getLatestAttempt(
      runId,
      stage,
    );
    if (latestAttempt && latestAttempt.status === "running") {
      this.repos.stageAttempts.recordFailure(
        latestAttempt.id,
        LEASE_EXPIRED_REASON,
        undefined,
        now,
      );
      return true;
    }
    return false;
  }

  /**
   * Expires stale claimed jobs and transitions exhausted runs to recovery_required.
   * An expired lease always closes the previous running stage attempt.
   */
  expireJobs(): ExpireJobsResult {
    const { expiredCount, recoveryRequiredCount } = this.sweepStaleJobs(false);
    return { expiredCount, recoveryRequiredCount };
  }

  /**
   * Startup recovery: like `expireJobs`, and a stale job that still has
   * attempts left goes back to pending so any worker can claim it.
   */
  recoverStaleJobs(): RecoverJobsResult {
    return this.sweepStaleJobs(true);
  }

  private sweepStaleJobs(requeue: boolean): RecoverJobsResult {
    let expiredCount = 0;
    let recoveryRequiredCount = 0;
    let recoveredCount = 0;
    const now = this.nowIso();

    for (const job of this.repos.jobs.findStaleClaimedJobs(now)) {
      expiredCount++;
      if (job.attempts >= job.maxAttempts) {
        if (this.exhaustJob(job)) {
          recoveryRequiredCount++;
          continue;
        }
      }
      // The expired lease closes the attempt even when the job cannot be exhausted.
      this.closeRunningStageAttempt(job.runId, job.stage, now);
      if (job.attempts >= job.maxAttempts) continue;
      if (requeue && this.repos.jobs.requeueJob(job.id, undefined, now)) {
        recoveredCount++;
        this.emitLog({
          result: "recovered",
          run_id: job.runId,
          job_id: job.id,
          stage: job.stage,
          attempt: job.attempts,
          message: `Recovered stale claimed job ${job.id} for run ${job.runId} (stage: ${job.stage}). Re-queued for execution.`,
        });
      }
    }

    return { expiredCount, recoveryRequiredCount, recoveredCount };
  }

  /**
   * Moves a job with exhausted attempts to failed and the parent run to
   * recovery_required. The job failure, the stage-attempt close and the run
   * transition are one transaction: if any of them throws, none is kept.
   * Returns false, having changed nothing, when the run is missing or cannot
   * move to recovery_required, or when the job is no longer claimed.
   */
  exhaustJob(job: JobRecord): boolean {
    const now = this.nowIso();
    const conn = this.repos.db;

    const run = this.repos.runs.get(job.runId);
    if (!run || !canTransition(run.status, "recovery_required")) return false;

    const exhausted = conn.transaction(() => {
      const failed = this.repos.jobs.failExhaustedJob(
        job.id,
        "Maximum retry attempts exhausted across worker lifetimes.",
        conn,
        now,
      );
      if (!failed) return false;

      this.closeRunningStageAttempt(job.runId, job.stage, now);
      this.repos.runs.transitionRun(
        run.id,
        run.status,
        "recovery_required",
        {
          expectedRevision: run.revision,
          now,
          event: {
            type: "status",
            payload: {
              status: "recovery_required",
              reason: `Job attempts (${job.attempts}/${job.maxAttempts}) exhausted for stage ${job.stage}.`,
            },
          },
        },
        conn,
      );
      return true;
    })();

    if (exhausted) {
      this.emitLog({
        result: "recovery_required",
        run_id: run.id,
        job_id: job.id,
        stage: job.stage,
        attempt: job.attempts,
        message: `Job ${job.id} for run ${run.id} exhausted maximum attempts (${job.attempts}/${job.maxAttempts}). Transitioned run to recovery_required.`,
      });
    }
    return exhausted;
  }

  /**
   * Atomically claims the next schedulable job for the given worker.
   * Closes any previous running stage attempt for reclaimed jobs.
   */
  claimNextJob(
    workerId: string,
    leaseDurationMs = this.policy.jobLeaseTtlMs,
  ): JobRecord | null {
    // Sweep exhausted jobs to recovery_required and close stale attempts first.
    this.expireJobs();

    const claimed = this.repos.jobs.claimNextJob(
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );
    this.closePriorAttempt(claimed);
    return claimed;
  }

  /**
   * Atomically claims the next schedulable job for a specific run.
   */
  claimJobForRun(
    runId: string,
    workerId: string,
    leaseDurationMs = this.policy.jobLeaseTtlMs,
  ): JobRecord | null {
    this.expireJobs();

    const claimed = this.repos.jobs.claimJobForRun(
      runId,
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );
    this.closePriorAttempt(claimed);
    return claimed;
  }

  // Reclaiming an expired job: the prior running attempt must be closed.
  private closePriorAttempt(claimed: JobRecord | null): void {
    if (claimed && claimed.attempts > 1) {
      this.closeRunningStageAttempt(
        claimed.runId,
        claimed.stage,
        this.nowIso(),
      );
    }
  }

  /**
   * Renews the lease for an actively claimed job.
   */
  renewJobLease(
    jobId: string,
    workerId: string,
    leaseDurationMs = this.policy.jobLeaseTtlMs,
  ): boolean {
    return this.repos.jobs.renewLease(
      jobId,
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );
  }

  /**
   * Releases an active lease back to 'pending' (e.g. during graceful shutdown).
   */
  releaseJobLease(jobId: string, workerId: string): boolean {
    return this.repos.jobs.releaseLease(
      jobId,
      workerId,
      undefined,
      this.nowIso(),
    );
  }

  /**
   * Expires stale claimed commands that have exhausted their retry budget.
   * Marked failed instead of being left claimed.
   */
  expireCommands(): ExpireCommandsResult {
    return {
      expiredCount: this.repos.commands.failExpiredCommands(this.nowIso()),
    };
  }

  /**
   * Claims all eligible pending commands for the given worker. Expired
   * commands with no retries left are failed first.
   */
  claimCommands(
    workerId: string,
    leaseDurationMs = this.policy.commandLeaseTtlMs,
    heartbeatTtlMs = this.policy.heartbeatTtlMs,
  ): CommandRecord[] {
    this.expireCommands();
    return this.repos.commands.claimPendingCommands(
      workerId,
      leaseDurationMs,
      heartbeatTtlMs,
      undefined,
      this.nowMs(),
    );
  }

  /**
   * Renews the lease for an actively claimed command.
   */
  renewCommandLease(
    commandId: string,
    workerId: string,
    leaseDurationMs = this.policy.commandLeaseTtlMs,
  ): boolean {
    return this.repos.commands.renewLease(
      commandId,
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );
  }

  completeCommand(
    commandId: string,
    workerId: string,
    result?: unknown,
  ): boolean {
    return this.repos.commands.completeCommand(
      commandId,
      workerId,
      result,
      undefined,
      this.nowIso(),
    );
  }

  failCommand(commandId: string, workerId: string, error: string): boolean {
    return this.repos.commands.failCommand(
      commandId,
      workerId,
      error,
      undefined,
      this.nowIso(),
    );
  }

  /** Is this worker's heartbeat within the policy TTL, by the injected clock? */
  isWorkerActive(workerId: string): boolean {
    return this.repos.heartbeats.isWorkerActive(
      workerId,
      this.policy.heartbeatTtlMs,
      undefined,
      this.nowMs(),
    );
  }

  /** Has any worker heartbeated within the policy TTL, by the injected clock? */
  isReady(): boolean {
    return this.repos.heartbeats.isReady(
      this.policy.heartbeatTtlMs,
      undefined,
      this.nowMs(),
    );
  }

  activeWorkers(): WorkerHeartbeatRecord[] {
    return this.repos.heartbeats.getActiveWorkers(
      this.policy.heartbeatTtlMs,
      undefined,
      this.nowMs(),
    );
  }
}
