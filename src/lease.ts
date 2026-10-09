// src/lease.ts — Lease module for background jobs and operator commands (#180).
//
// Owns claim, renew, release, expire and exhaust for both jobs and commands,
// with timeouts as policy and an injected clock.

import type { Repositories } from "./composition-root.js";
import type { CommandRecord } from "./db/command-repository.js";
import type { JobRecord } from "./db/job-repository.js";
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

export type ClockLike = Clock | (() => number);

export function getClockMs(clock?: ClockLike): number {
  if (!clock) return Date.now();
  if (typeof clock === "function") return clock();
  return clock.now();
}

export interface LeaseStructuredLogEntry {
  result: "recovered" | "recovery_required" | "claimed" | "renewed";
  run_id?: string | undefined;
  job_id?: string | undefined;
  stage?: string | undefined;
  attempt?: number | undefined;
  message?: string | undefined;
}

export interface LeaseManagerOptions {
  clock?: ClockLike | undefined;
  policy?: Partial<LeasePolicy> | undefined;
  onLog?: ((entry: LeaseStructuredLogEntry) => void) | undefined;
}

export interface ExpireJobsResult {
  expiredCount: number;
  recoveryRequiredCount: number;
}

export interface ExpireCommandsResult {
  expiredCount: number;
}

export class LeaseManager {
  private repos: Repositories;
  private clock?: ClockLike | undefined;
  readonly policy: LeasePolicy;
  private onLog?: ((entry: LeaseStructuredLogEntry) => void) | undefined;

  constructor(repos: Repositories, options?: LeaseManagerOptions) {
    this.repos = repos;
    this.clock = options?.clock;
    this.policy = {
      ...DEFAULT_LEASE_POLICY,
      ...options?.policy,
    };
    this.onLog = options?.onLog;
  }

  private nowMs(): number {
    return getClockMs(this.clock);
  }

  private nowIso(): string {
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
   * Closes any currently running stage attempt for a run and stage due to lease expiry.
   */
  private closeRunningStageAttempt(
    runId: string,
    stage: string,
    reason = "Worker lease expired",
  ): boolean {
    const latestAttempt = this.repos.stageAttempts.getLatestAttempt(
      runId,
      stage,
    );
    if (latestAttempt && latestAttempt.status === "running") {
      this.repos.stageAttempts.recordFailure(latestAttempt.id, reason);
      return true;
    }
    return false;
  }

  /**
   * Expires stale claimed jobs and transitions exhausted runs to recovery_required.
   * An expired lease always closes the previous running stage attempt.
   */
  expireJobs(workerId?: string): ExpireJobsResult {
    let expiredCount = 0;
    let recoveryRequiredCount = 0;
    const now = this.nowIso();

    const staleJobs = this.repos.jobs.findStaleClaimedJobs(now);

    for (const job of staleJobs) {
      expiredCount++;
      // An expired lease always closes the previous stage attempt.
      this.closeRunningStageAttempt(
        job.runId,
        job.stage,
        "Worker lease expired",
      );

      if (job.attempts >= job.maxAttempts) {
        if (this.exhaustJob(job, workerId)) {
          recoveryRequiredCount++;
        }
      }
    }

    return { expiredCount, recoveryRequiredCount };
  }

  /**
   * Moves a job with exhausted attempts to failed and the parent run to recovery_required.
   */
  exhaustJob(job: JobRecord, _workerId?: string): boolean {
    const now = this.nowIso();
    const conn = this.repos.db;

    // Close any open stage attempt
    this.closeRunningStageAttempt(job.runId, job.stage, "Worker lease expired");

    // Fail the job in the database
    conn
      .prepare(`
        UPDATE jobs
        SET status = 'failed',
            worker_id = NULL,
            lease_until = NULL,
            error = $error,
            updated_at = $now
        WHERE id = $id AND status = 'claimed';
      `)
      .run({
        $id: job.id,
        $error: "Maximum retry attempts exhausted across worker lifetimes.",
        $now: now,
      });

    const run = this.repos.runs.get(job.runId);
    if (!run) return false;

    this.emitLog({
      result: "recovery_required",
      run_id: run.id,
      job_id: job.id,
      stage: job.stage,
      attempt: job.attempts,
      message: `Job ${job.id} for run ${run.id} exhausted maximum attempts (${job.attempts}/${job.maxAttempts}). Transitioning run to recovery_required.`,
    });

    if (canTransition(run.status, "recovery_required")) {
      try {
        this.repos.runs.transitionRun(run.id, run.status, "recovery_required", {
          event: {
            type: "status",
            payload: {
              status: "recovery_required",
              reason: `Job attempts (${job.attempts}/${job.maxAttempts}) exhausted for stage ${job.stage}.`,
            },
          },
        });
        return true;
      } catch (err) {
        console.error(
          `Failed to transition run ${run.id} to recovery_required:`,
          err,
        );
        return false;
      }
    }

    return false;
  }

  /**
   * Atomically claims the next schedulable job for the given worker.
   * Closes any previous running stage attempt for reclaimed jobs.
   */
  claimNextJob(
    workerId: string,
    leaseDurationMs = this.policy.jobLeaseTtlMs,
  ): JobRecord | null {
    // Run an expiry check to sweep exhausted jobs to recovery_required and close stale attempts
    this.expireJobs(workerId);

    const claimed = this.repos.jobs.claimNextJob(
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );

    if (claimed && claimed.attempts > 1) {
      // Reclaiming an expired job: ensure the prior running attempt is closed.
      this.closeRunningStageAttempt(
        claimed.runId,
        claimed.stage,
        "Worker lease expired",
      );
    }

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
    this.expireJobs(workerId);

    const claimed = this.repos.jobs.claimJobForRun(
      runId,
      workerId,
      leaseDurationMs,
      undefined,
      this.nowMs(),
    );

    if (claimed && claimed.attempts > 1) {
      this.closeRunningStageAttempt(
        claimed.runId,
        claimed.stage,
        "Worker lease expired",
      );
    }

    return claimed;
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
    return this.repos.jobs.releaseLease(jobId, workerId);
  }

  /**
   * Expires stale claimed commands that have exhausted their retry budget.
   * Marked failed instead of being left claimed.
   */
  expireCommands(): ExpireCommandsResult {
    const now = this.nowIso();
    const conn = this.repos.db;

    const res = conn
      .prepare(`
        UPDATE run_commands
        SET status = 'failed',
            worker_id = NULL,
            lease_until = NULL,
            error = 'Command lease expired; retries exhausted',
            processed_at = $now
        WHERE status = 'claimed' AND lease_until < $now AND attempts >= max_attempts;
      `)
      .run({ $now: now });

    return { expiredCount: res.changes };
  }

  /**
   * Claims all eligible pending commands for the given worker.
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
}
