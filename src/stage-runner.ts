// src/stage-runner.ts — The stage runner (#190). One lifecycle for every unit of stage work:
// claim (done by the lease module) → attempt start → heartbeat → execute → cancellation
// re-check → commit the output and the transition atomically, or fail.
//
// A job and the deliver command differ only in where their lease comes from and how they
// finish; each says so through a `StageWork`. Executors get a narrow context and return a
// StageOutcome; nothing they return is persisted unless the run is still live at the
// re-check, and then it is committed in the same transaction as the transition.

import type { Repositories } from "./composition-root.js";
import type { CommandRecord } from "./db/command-repository.js";
import type { JobRecord } from "./db/job-repository.js";
import type { RunRecord } from "./db/run-repository.js";
import type { StageAttemptRecord } from "./db/stage-attempt-repository.js";
import type {
  StageContext,
  StageEvent,
  StageExecutor,
  StageOutcome,
  StageRecord,
  StageRunUpdate,
} from "./executors/types.js";
import type { LeaseManager, WorkerLogRecord } from "./lease.js";
import { canTransition } from "./shared/run-status-policy.js";
import type { Project, RunStatus } from "./shared/types.js";
import {
  isWorkflowStage,
  PASSED_ROUTES,
  REJECTED_RUN_STATUS,
} from "./workflow.js";

/** Where a unit of stage work came from and how it finishes. */
export interface StageWork {
  /** Job or command id, for logs. */
  readonly id: string;
  readonly kind: "job" | "command";
  readonly runId: string;
  readonly stage: string;
  readonly attempt: number;
  readonly heartbeatIntervalMs: number;
  /** Renews the lease. False when it was lost. */
  renew(): boolean;
  /** A source-specific cancellation, beyond the run being stopped (a cancelled job). */
  isCancelled(): boolean;
  /** Does this worker still own the lease? Checked inside the commit transaction. */
  holdsLease(): boolean;
  /** Checks a passed outcome before it is committed; a message fails the work instead. */
  invalidPassed?(
    outcome: Extract<StageOutcome, { outcome: "passed" }>,
  ): string | null;
  /** Finishes a passed unit of work. Runs inside the commit transaction. */
  complete(outcome: Extract<StageOutcome, { outcome: "passed" }>): void;
  /** Finishes a rejected unit of work, without retry. Runs inside the commit transaction. */
  reject(reason: string): void;
  /**
   * Finishes a failed unit of work. Returns whether it will be tried again; when not, the
   * run is failed if `failsRunWhenExhausted`.
   */
  fail(error: string): { willRetry: boolean; attempts: number };
  readonly failsRunWhenExhausted: boolean;
  /** Called when the run was stopped under the work. */
  cancel(reason: string): void;
  /** The attempt count shown in logs and the retry budget. */
  readonly maxAttempts: number;
}

export interface StageRunnerHost {
  readonly workerId: string;
  readonly repos: Repositories;
  readonly leases: LeaseManager;
  resolveProject(runId: string): Promise<Project>;
  upsertHeartbeat(): void;
  /** True once the worker is shutting down; its leases are released and nothing is committed. */
  isShuttingDown(): boolean;
  log(message: string): void;
  error(message: string, err?: unknown): void;
  emitLog(entry: Omit<WorkerLogRecord, "timestamp" | "worker_id">): void;
}

const CANCEL_REASON = "Run stopped by operator during stage execution";

function isStageOutcome(value: unknown): value is StageOutcome {
  if (typeof value !== "object" || value === null) return false;
  const outcome = (value as { outcome?: unknown }).outcome;
  return outcome === "passed" || outcome === "rejected" || outcome === "error";
}

export function jobWork(
  job: JobRecord,
  host: StageRunnerHost,
  jobLeaseTtlMs: number,
  heartbeatIntervalMs: number,
): StageWork {
  const { repos, leases, workerId } = host;
  return {
    id: job.id,
    kind: "job",
    runId: job.runId,
    stage: job.stage,
    attempt: job.attempts,
    heartbeatIntervalMs,
    maxAttempts: job.maxAttempts,
    failsRunWhenExhausted: true,
    renew: () => leases.renewJobLease(job.id, workerId, jobLeaseTtlMs),
    isCancelled: () => repos.jobs.getJob(job.id)?.status === "cancelled",
    holdsLease: () => {
      const current = repos.jobs.getJob(job.id, repos.db);
      return current?.status === "claimed" && current.workerId === workerId;
    },
    complete: () => {
      repos.jobs.completeJob(job.id, workerId, repos.db);
    },
    reject: (reason) => {
      repos.jobs.rejectJob(job.id, workerId, reason, repos.db);
    },
    fail: (error) => repos.jobs.failJob(job.id, workerId, error),
    cancel: () => {},
  };
}

export function deliverCommandWork(
  command: CommandRecord,
  host: StageRunnerHost,
  commandLeaseTtlMs: number,
  heartbeatIntervalMs: number,
): StageWork {
  const { repos, leases, workerId } = host;
  const failCommand = (error: string): void => {
    repos.commands.failCommand(
      command.id,
      workerId,
      error,
      repos.db,
      leases.nowIso(),
    );
  };
  return {
    id: command.id,
    kind: "command",
    runId: command.runId,
    stage: "deliver",
    attempt: command.attempts,
    heartbeatIntervalMs,
    maxAttempts: command.maxAttempts,
    failsRunWhenExhausted: false,
    renew: () =>
      leases.renewCommandLease(command.id, workerId, commandLeaseTtlMs),
    isCancelled: () => false,
    holdsLease: () => {
      const current = repos.commands.getCommand(command.id, repos.db);
      return current?.status === "claimed" && current.workerId === workerId;
    },
    invalidPassed: (outcome) =>
      outcome.record?.run?.pullRequest
        ? null
        : "Deliver passed without recording a pull request",
    complete: (outcome) => {
      repos.commands.completeCommand(
        command.id,
        workerId,
        { prUrl: outcome.record?.run?.pullRequest?.url },
        repos.db,
        leases.nowIso(),
      );
    },
    reject: failCommand,
    fail: (error) => {
      failCommand(error);
      return { willRetry: false, attempts: command.attempts };
    },
    cancel: failCommand,
  };
}

/** The narrow context an executor runs with: inputs, `emit`, a run-bound ledger, a signal. */
export function buildStageContext(
  repos: Repositories,
  run: RunRecord,
  project: Project,
  identity: Pick<StageContext, "stage" | "attempt" | "workerId" | "signal">,
): StageContext {
  return {
    ...identity,
    run,
    project,
    emit: (type, payload) => {
      repos.events.appendEvent(run.id, type, payload);
    },
    ledger: {
      execute: (operation, fn, reconcile, prepareContext) =>
        repos.operationLedger.executeWithLedger(
          run.id,
          operation,
          fn,
          reconcile,
          prepareContext,
        ),
    },
  };
}

export class StageRunner {
  constructor(private readonly host: StageRunnerHost) {}

  /**
   * Runs one claimed unit of stage work to its end. Never throws for a stage failure; the
   * failure is recorded against the attempt and the work.
   */
  async run(
    work: StageWork,
    executor: StageExecutor,
    signal: AbortSignal,
  ): Promise<void> {
    const { repos } = this.host;
    const startTime = performance.now();
    this.host.log(
      `Stage started: id=${work.id} run_id=${work.runId} stage=${work.stage}`,
    );

    const heartbeat = this.startHeartbeat(work);
    // Once aborted (shutdown, stop), this worker no longer vouches for the work.
    signal.addEventListener("abort", () => clearInterval(heartbeat), {
      once: true,
    });
    try {
      // Early cancellation gate
      const run = repos.runs.get(work.runId);
      if (!run || run.status === "stopped" || work.isCancelled()) {
        this.host.log(
          `Stage ${work.id} skipped due to early cancellation: run status is ${run?.status}`,
        );
        return;
      }

      const project = await this.host.resolveProject(work.runId);
      const attempt = repos.stageAttempts.recordStart(
        run.id,
        work.stage,
        work.attempt,
      );

      const context = buildStageContext(repos, run, project, {
        stage: work.stage,
        attempt: work.attempt,
        workerId: this.host.workerId,
        signal,
      });

      let outcome: StageOutcome;
      try {
        const returned: unknown = await executor.execute(context);
        outcome = isStageOutcome(returned)
          ? returned
          : {
              outcome: "error",
              error: `Stage ${work.stage} returned an invalid outcome`,
            };
      } catch (err: unknown) {
        if (this.host.isShuttingDown()) return;
        if (this.stoppedUnder(work, attempt, startTime)) return;
        this.fail(
          work,
          attempt,
          err instanceof Error ? err.message : String(err),
          elapsed(startTime),
        );
        return;
      }

      if (this.host.isShuttingDown()) return;
      // Re-read state after the executor: a mid-flight stop discards its output.
      if (this.stoppedUnder(work, attempt, startTime)) return;

      const duration = elapsed(startTime);
      if (outcome.outcome === "passed") {
        const invalid = work.invalidPassed?.(outcome);
        if (invalid) {
          this.fail(work, attempt, invalid, duration);
        } else {
          this.commitPassed(work, attempt, outcome, duration, run.status);
        }
      } else if (outcome.outcome === "rejected") {
        this.commitRejected(work, attempt, outcome, duration);
      } else {
        this.fail(work, attempt, outcome.error, duration, outcome.record);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private startHeartbeat(work: StageWork): ReturnType<typeof setInterval> {
    const { host } = this;
    const subject = work.kind === "job" ? { job_id: work.id } : {};
    const label = work.kind === "job" ? `job ${work.id}` : `command ${work.id}`;
    return setInterval(() => {
      try {
        host.upsertHeartbeat();
        if (work.renew()) {
          host.emitLog({
            ...subject,
            result: "renewed",
            message:
              work.kind === "job"
                ? "Worker lease renewed successfully"
                : `Command ${work.id} lease renewed successfully`,
          });
        } else {
          host.emitLog({
            ...subject,
            result: "heartbeat_lost",
            message:
              work.kind === "job"
                ? `Heartbeat lease renewal failed for job ${work.id}. Worker may have lost lease.`
                : `Command lease renewal failed for command ${work.id}. Worker may have lost lease.`,
          });
        }
      } catch (err: unknown) {
        host.error(`Heartbeat error renewing lease for ${label}`, err);
      }
    }, work.heartbeatIntervalMs);
  }

  /** Records a cancellation and returns true when the run was stopped under the work. */
  private stoppedUnder(
    work: StageWork,
    attempt: StageAttemptRecord,
    startTime: number,
  ): boolean {
    const { repos } = this.host;
    const run = repos.runs.get(work.runId);
    if (run?.status !== "stopped" && !work.isCancelled()) return false;

    repos.stageAttempts.recordCancellation(attempt.id, CANCEL_REASON);
    work.cancel(CANCEL_REASON);
    this.host.emitLog({
      ...(work.kind === "job" ? { job_id: work.id } : {}),
      run_id: work.runId,
      stage: work.stage,
      attempt: work.attempt,
      duration_ms: elapsed(startTime),
      result: "cancelled",
      message: `Stage '${work.stage}' cancelled due to run stop.`,
    });
    return true;
  }

  /** Writes a stage's record. Runs inside a commit transaction. */
  private applyRecord(runId: string, record: StageRecord | undefined): void {
    if (!record) return;
    const { repos } = this.host;
    if (record.run && hasFields(record.run)) {
      repos.runs.update(runId, record.run, repos.db);
    }
    for (const event of record.events ?? ([] as readonly StageEvent[])) {
      repos.events.appendEvent(runId, event.type, event.payload, repos.db);
    }
  }

  private commitPassed(
    work: StageWork,
    attempt: StageAttemptRecord,
    outcome: Extract<StageOutcome, { outcome: "passed" }>,
    duration: number,
    expectedRunStatus: RunStatus,
  ): void {
    const { repos } = this.host;
    const route = isWorkflowStage(work.stage)
      ? PASSED_ROUTES[work.stage]
      : null;

    const committed = repos.db.transaction(() => {
      const current = repos.runs.get(work.runId, repos.db);
      if (!work.holdsLease() || current?.status !== expectedRunStatus) {
        return false;
      }

      repos.stageAttempts.recordCompletion(
        attempt.id,
        outcome.output,
        repos.db,
      );
      this.applyRecord(work.runId, outcome.record);

      if (route && current.status !== route.to) {
        repos.runs.transitionRun(
          work.runId,
          current.status,
          route.to,
          {
            event: {
              type: "status",
              payload: {
                status: route.to,
                text: `Stage '${work.stage}' completed. Transitioning to '${route.to}'.`,
                ...outcome.record?.statusPayload,
              },
            },
          },
          repos.db,
        );
      }

      // The workflow route decides which stage runs next.
      if (route?.nextStage) {
        repos.jobs.createJob(
          { runId: work.runId, stage: route.nextStage, status: "pending" },
          repos.db,
        );
      }

      work.complete(outcome);
      return true;
    })();

    if (!committed) {
      this.host.log(
        `Progression CAS check failed for ${work.kind} ${work.id} on run ${work.runId}. Stage progression aborted.`,
      );
      return;
    }

    this.host.emitLog({
      ...(work.kind === "job" ? { job_id: work.id } : {}),
      run_id: work.runId,
      stage: work.stage,
      attempt: work.attempt,
      duration_ms: duration,
      result: "success",
      message: `Stage '${work.stage}' completed successfully`,
    });
    this.host.log(
      `Stage completed successfully: id=${work.id}, stage=${work.stage}`,
    );
  }

  /**
   * A rejected stage is a verdict: the work fails without a retry and the run ends in
   * `failed` carrying the rejection (#181).
   */
  private commitRejected(
    work: StageWork,
    attempt: StageAttemptRecord,
    outcome: Extract<StageOutcome, { outcome: "rejected" }>,
    duration: number,
  ): void {
    const { repos } = this.host;
    const reason = outcome.reason;
    this.host.error(`Stage '${work.stage}' rejected: ${reason}`);

    try {
      repos.stageAttempts.recordFailure(attempt.id, reason);
    } catch (e: unknown) {
      this.host.error("Failed to record stage attempt rejection", e);
    }

    try {
      repos.db.transaction(() => {
        work.reject(reason);
        const latest = repos.runs.get(work.runId, repos.db);
        if (!latest) return;
        this.applyRecord(work.runId, outcome.record);
        if (canTransition(latest.status, REJECTED_RUN_STATUS)) {
          repos.runs.transitionRun(
            work.runId,
            latest.status,
            REJECTED_RUN_STATUS,
            {
              event: {
                type: "status",
                payload: {
                  status: REJECTED_RUN_STATUS,
                  text: `Run failed during stage '${work.stage}': ${reason}`,
                },
              },
            },
            repos.db,
          );
        } else {
          const text = `Rejection not applied: run is in status "${latest.status}", which cannot transition to ${REJECTED_RUN_STATUS}.`;
          repos.events.appendEvent(work.runId, "info", { text }, repos.db);
          this.host.error(`Run ${work.runId}: ${text}`);
        }
      })();
    } catch (err: unknown) {
      this.host.error(`Failed to end run ${work.runId} after rejection`, err);
      return;
    }

    this.host.emitLog({
      ...(work.kind === "job" ? { job_id: work.id } : {}),
      run_id: work.runId,
      stage: work.stage,
      attempt: work.attempt,
      duration_ms: duration,
      result: "failure",
      message: `Stage '${work.stage}' rejected; run ended without retry`,
      error: reason,
    });
  }

  private fail(
    work: StageWork,
    attempt: StageAttemptRecord,
    errorMsg: string,
    durationMs: number,
    record?: StageRecord,
  ): void {
    const { repos } = this.host;
    this.host.error(`Stage '${work.stage}' execution failed: ${errorMsg}`);

    if (record) {
      try {
        repos.db.transaction(() => this.applyRecord(work.runId, record))();
      } catch (e: unknown) {
        this.host.error("Failed to record failed stage's output", e);
      }
    }

    try {
      repos.stageAttempts.recordFailure(attempt.id, errorMsg);
    } catch (e: unknown) {
      this.host.error("Failed to record stage attempt failure", e);
    }

    const retry = work.fail(errorMsg);
    const subject = work.kind === "job" ? { job_id: work.id } : {};

    if (retry.willRetry) {
      this.host.emitLog({
        ...subject,
        run_id: work.runId,
        stage: work.stage,
        attempt: retry.attempts,
        duration_ms: durationMs,
        result: "retry",
        message: `Job scheduled for retry (${retry.attempts}/${work.maxAttempts})`,
        error: errorMsg,
      });
      this.host.log(
        `Job scheduled for retry (attempt ${retry.attempts}/${work.maxAttempts}): job_id=${work.id}`,
      );
      return;
    }

    const noun = work.kind === "job" ? "Job" : "Command";
    const detail =
      work.kind === "job"
        ? `terminal failure (exhausted ${retry.attempts} attempts)`
        : "failure";
    this.host.emitLog({
      ...subject,
      run_id: work.runId,
      stage: work.stage,
      attempt: retry.attempts,
      duration_ms: durationMs,
      result: "failure",
      message: `${noun} entered ${detail}`,
      error: errorMsg,
    });
    this.host.log(`${noun} entered ${detail}: id=${work.id}`);

    if (!work.failsRunWhenExhausted) return;
    try {
      const latest = repos.runs.get(work.runId);
      if (latest && canTransition(latest.status, "failed")) {
        repos.runs.transitionRun(work.runId, latest.status, "failed", {
          event: {
            type: "status",
            payload: {
              status: "failed",
              text: `Run failed during stage '${work.stage}': ${errorMsg}`,
            },
          },
        });
      }
    } catch (err: unknown) {
      this.host.error(`Failed to transition run ${work.runId} to failed`, err);
    }
  }
}

function elapsed(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

function hasFields(update: StageRunUpdate): boolean {
  return Object.values(update).some((value) => value !== undefined);
}
