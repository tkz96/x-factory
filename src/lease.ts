// src/lease.ts — Lease module for background jobs and operator commands (#180).
//
// Owns claim, renew, release, expire and exhaust for both jobs and commands,
// with timeouts as policy and an injected clock.

import type { Repositories } from "./composition-root.js";
import type { CommandRecord } from "./db/command-repository.js";
import type { JobRecord } from "./db/job-repository.js";
import type { WorkerHeartbeatRecord } from "./db/worker-heartbeat-repository.js";
import {
  AWAITING_HUMAN_RUN_STATUSES,
  canTransition,
  EXECUTABLE_RUN_STATUSES,
} from "./shared/run-status-policy.js";

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
export interface WorkerLogRecord {
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
  WorkerLogRecord,
  "timestamp" | "worker_id"
>;

type StaleOutcome =
  | "exhausted"
  | "requeued"
  | "abandoned"
  | "expired"
  | "skipped";

const EXHAUSTED = "Maximum retry attempts exhausted across worker lifetimes.";
const ABANDONED = "Run no longer allows this job; job abandoned.";

/** The one reason recorded on a stage attempt closed because its lease expired. */
const LEASE_EXPIRED_REASON =
  "Worker lease expired; Worker process terminated during execution.";

/** The reason recorded on a stage attempt closed because its worker released the job. */
const LEASE_RELEASED_REASON =
  "Worker released the job during shutdown before the stage finished.";

const ORPHANED_RUN_REASON =
  "Active run found without any pending or claimed workflow jobs on worker startup.";

/**
 * (job id, stable error identity) keys already logged for a settlement failure
 * in this process, kept in insertion order so the oldest key can be evicted.
 * A job that cannot be settled rolls back on every sweep, so the worker would
 * otherwise log the same line once per poll tick (~1s) forever (#163). Each
 * distinct (job id, error identity) is logged at most once per process; the
 * sweep still isolates the failure and keeps claiming the other jobs.
 */
const loggedSettleFailures = new Set<string>();

/**
 * Hard cap on remembered settle-failure keys. Past it the oldest key is evicted
 * first, so a stream of distinct poison identities cannot grow the set without
 * bound. Re-logging an evicted identity once is harmless next to memory that
 * never stops growing.
 */
export const SETTLE_FAILURE_LOG_CAP = 1000;

/**
 * A stable identity for an error: its class name plus its code when it carries
 * one. Deliberately NOT the message, which may embed a timestamp, counter or id
 * that changes per attempt and would make every tick look like a new failure.
 */
function stableErrorIdentity(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      return `${err.name}:${String(code)}`;
    }
    return err.name;
  }
  // A non-Error throw is rare; classify by type, never by stringified content.
  return typeof err;
}

/** Records one settle-failure log key; false when that (job, error identity) was logged before. */
function shouldLogSettleFailure(jobId: string, err: unknown): boolean {
  const key = JSON.stringify([jobId, stableErrorIdentity(err)]);
  if (loggedSettleFailures.has(key)) return false;
  loggedSettleFailures.add(key);
  if (loggedSettleFailures.size > SETTLE_FAILURE_LOG_CAP) {
    const oldest = loggedSettleFailures.values().next().value;
    if (oldest !== undefined) loggedSettleFailures.delete(oldest);
  }
  return true;
}

/** Test seam: how many distinct settle-failure identities are remembered right now. */
export function settleFailureLogSizeForTesting(): number {
  return loggedSettleFailures.size;
}

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
    reason = LEASE_EXPIRED_REASON,
  ): boolean {
    const latestAttempt = this.repos.stageAttempts.getLatestAttempt(
      runId,
      stage,
    );
    if (latestAttempt && latestAttempt.status === "running") {
      this.repos.stageAttempts.recordFailure(latestAttempt.id, reason, now);
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
    const result: RecoverJobsResult = {
      expiredCount: 0,
      recoveryRequiredCount: 0,
      recoveredCount: 0,
    };
    const now = this.nowIso();

    // A pending job with no attempts left can never be claimed; settle it first.
    for (const job of this.repos.jobs.findExhaustedPendingJobs()) {
      try {
        if (this.settleExhaustedPendingJob(job, now) === "skipped") continue;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (shouldLogSettleFailure(job.id, err)) {
          this.emitLog({
            result: "error",
            run_id: job.runId,
            job_id: job.id,
            stage: job.stage,
            attempt: job.attempts,
            message: `Could not settle exhausted pending job ${job.id} for run ${job.runId}.`,
            error,
          });
        }
        continue;
      }
      result.expiredCount++;
      result.recoveryRequiredCount++;
      this.logStaleOutcome(job, "exhausted");
    }

    for (const job of this.repos.jobs.findStaleClaimedJobs(now)) {
      let outcome: StaleOutcome;
      try {
        outcome = this.settleStaleJob(job, requeue, now);
      } catch (err) {
        // One job that cannot be settled must not stop the sweep or the claim
        // that follows it. Its transaction rolled back, so it is retried later;
        // that repeated failure is logged once per (job id, error identity) per
        // process.
        const error = err instanceof Error ? err.message : String(err);
        if (shouldLogSettleFailure(job.id, err)) {
          this.emitLog({
            result: "error",
            run_id: job.runId,
            job_id: job.id,
            stage: job.stage,
            attempt: job.attempts,
            message: `Could not settle stale job ${job.id} for run ${job.runId}.`,
            error,
          });
        }
        continue;
      }
      if (outcome === "skipped") continue;
      result.expiredCount++;
      if (outcome === "exhausted") result.recoveryRequiredCount++;
      if (outcome === "requeued") result.recoveredCount++;
      this.logStaleOutcome(job, outcome);
    }

    return result;
  }

  /**
   * Settles one stale claimed job in a single transaction, so a failure leaves
   * nothing half done. The job is re-read under the write lock: a lease
   * renewed since the sweep read it is left alone ("skipped").
   *
   * - spent retry budget: job failed, run to recovery_required;
   * - attempts left (startup recovery): job requeued;
   * - run missing or no longer in a state that allows either: job failed and
   *   the run untouched ("abandoned");
   * - otherwise (claim sweep): only the stage attempt is closed.
   */
  private settleStaleJob(
    job: JobRecord,
    requeue: boolean,
    now: string,
  ): StaleOutcome {
    return this.repos.db
      .transaction((): StaleOutcome => {
        const fresh = this.repos.jobs.getJob(job.id);
        if (
          !fresh ||
          fresh.status !== "claimed" ||
          !fresh.leaseUntil ||
          fresh.leaseUntil >= now
        ) {
          return "skipped";
        }
        const run = this.repos.runs.get(fresh.runId);
        const exhausted = fresh.attempts >= fresh.maxAttempts;

        const abandon = (): StaleOutcome => {
          if (!this.repos.jobs.failExhaustedJob(fresh.id, ABANDONED, now))
            return "skipped";
          this.closeRunningStageAttempt(fresh.runId, fresh.stage, now);
          return "abandoned";
        };

        if (exhausted) {
          if (!run || !canTransition(run.status, "recovery_required"))
            return abandon();
          if (!this.repos.jobs.failExhaustedJob(fresh.id, EXHAUSTED, now))
            return "skipped";
          this.closeRunningStageAttempt(fresh.runId, fresh.stage, now);
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
                  reason: `Job attempts (${fresh.attempts}/${fresh.maxAttempts}) exhausted for stage ${fresh.stage}.`,
                },
              },
            },
          );
          return "exhausted";
        }

        if (!requeue) {
          this.closeRunningStageAttempt(fresh.runId, fresh.stage, now);
          return "expired";
        }
        if (!run || !EXECUTABLE_RUN_STATUSES.has(run.status)) return abandon();
        if (!this.repos.jobs.requeueJob(fresh.id, now)) return "skipped";
        this.closeRunningStageAttempt(fresh.runId, fresh.stage, now);
        return "requeued";
      })
      .immediate();
  }

  /**
   * Settles a pending job whose attempts are spent: the job fails and its run goes to
   * recovery_required, in one transaction. Returns "abandoned" when the run no longer
   * allows recovery (the job still fails, the run is untouched).
   */
  private settleExhaustedPendingJob(job: JobRecord, now: string): StaleOutcome {
    return this.repos.db
      .transaction((): StaleOutcome => {
        const run = this.repos.runs.get(job.runId);
        if (!run || !canTransition(run.status, "recovery_required")) {
          return this.repos.jobs.failExhaustedPendingJob(job.id, ABANDONED, now)
            ? "abandoned"
            : "skipped";
        }
        if (!this.repos.jobs.failExhaustedPendingJob(job.id, EXHAUSTED, now))
          return "skipped";
        this.closeRunningStageAttempt(job.runId, job.stage, now);
        this.repos.runs.transitionRun(run.id, run.status, "recovery_required", {
          expectedRevision: run.revision,
          now,
          event: {
            type: "status",
            payload: {
              status: "recovery_required",
              reason: `Job attempts (${job.attempts}/${job.maxAttempts}) exhausted for stage ${job.stage}.`,
            },
          },
        });
        return "exhausted";
      })
      .immediate();
  }

  /**
   * Startup recovery for runs that hold no live work: an active run that is not
   * waiting on a human and has no pending or claimed job goes to recovery_required,
   * its running stage attempts closed, in one transaction per run. Returns how
   * many runs were moved.
   */
  recoverOrphanedRuns(): number {
    let moved = 0;
    const now = this.nowIso();
    for (const candidate of this.repos.runs.listActive()) {
      if (AWAITING_HUMAN_RUN_STATUSES.has(candidate.status)) continue;
      try {
        const done = this.repos.db
          .transaction((): boolean => {
            const run = this.repos.runs.get(candidate.id);
            if (
              !run ||
              AWAITING_HUMAN_RUN_STATUSES.has(run.status) ||
              !canTransition(run.status, "recovery_required") ||
              this.repos.jobs.findActiveJobsForRun(run.id).length > 0
            ) {
              return false;
            }
            for (const attempt of this.repos.stageAttempts.listForRun(run.id)) {
              if (attempt.status === "running") {
                this.repos.stageAttempts.recordFailure(
                  attempt.id,
                  ORPHANED_RUN_REASON,
                  now,
                );
              }
            }
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
                    reason: ORPHANED_RUN_REASON,
                  },
                },
              },
            );
            return true;
          })
          .immediate();
        if (!done) continue;
        moved++;
        this.emitLog({
          result: "recovery_required",
          run_id: candidate.id,
          message: `Active run ${candidate.id} in status "${candidate.status}" has no pending or claimed jobs. Transitioned to recovery_required.`,
        });
      } catch (err) {
        this.emitLog({
          result: "error",
          run_id: candidate.id,
          message: `Failed to transition orphaned run ${candidate.id} to recovery_required.`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return moved;
  }

  private logStaleOutcome(job: JobRecord, outcome: StaleOutcome): void {
    const base = {
      run_id: job.runId,
      job_id: job.id,
      stage: job.stage,
      attempt: job.attempts,
    };
    if (outcome === "exhausted") {
      this.emitLog({
        ...base,
        result: "recovery_required",
        message: `Job ${job.id} for run ${job.runId} exhausted maximum attempts (${job.attempts}/${job.maxAttempts}). Transitioned run to recovery_required.`,
      });
    } else if (outcome === "requeued") {
      this.emitLog({
        ...base,
        result: "recovered",
        message: `Recovered stale claimed job ${job.id} for run ${job.runId} (stage: ${job.stage}). Re-queued for execution.`,
      });
    } else if (outcome === "abandoned") {
      this.emitLog({
        ...base,
        result: "failure",
        message: `Stale job ${job.id} failed: run ${job.runId} no longer allows it. The run was left untouched.`,
      });
    }
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
      this.nowMs(),
    );
  }

  /**
   * Releases an active lease back to 'pending' (e.g. during graceful shutdown).
   */
  releaseJobLease(jobId: string, workerId: string): boolean {
    const now = this.nowIso();
    return this.repos.db
      .transaction((): boolean => {
        const job = this.repos.jobs.getJob(jobId);
        if (!this.repos.jobs.releaseLease(jobId, workerId, now)) return false;
        // The released work never finished: its attempt must not stay "running".
        if (job) {
          this.closeRunningStageAttempt(
            job.runId,
            job.stage,
            now,
            LEASE_RELEASED_REASON,
          );
        }
        return true;
      })
      .immediate();
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
      this.nowIso(),
    );
  }

  failCommand(commandId: string, workerId: string, error: string): boolean {
    return this.repos.commands.failCommand(
      commandId,
      workerId,
      error,
      this.nowIso(),
    );
  }

  /** Is this worker's heartbeat within the policy TTL, by the injected clock? */
  isWorkerActive(workerId: string): boolean {
    return this.repos.heartbeats.isWorkerActive(
      workerId,
      this.policy.heartbeatTtlMs,
      this.nowMs(),
    );
  }

  /** Has any worker heartbeated within the policy TTL, by the injected clock? */
  isReady(): boolean {
    return this.repos.heartbeats.isReady(
      this.policy.heartbeatTtlMs,
      this.nowMs(),
    );
  }

  activeWorkers(): WorkerHeartbeatRecord[] {
    return this.repos.heartbeats.getActiveWorkers(
      this.policy.heartbeatTtlMs,
      this.nowMs(),
    );
  }
}
