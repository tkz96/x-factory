// src/db/job-repository.ts — SQLite-backed durable repository for background jobs and atomic worker claims.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { EXECUTABLE_RUN_STATUSES } from "../shared/run-status-policy.js";

const executableStatusesSql = Array.from(EXECUTABLE_RUN_STATUSES)
  .map((s) => `'${s}'`)
  .join(", ");

export type JobStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobRecord {
  id: string;
  runId: string;
  stage: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  workerId: string | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobInput {
  id?: string | undefined;
  runId: string;
  stage: string;
  status?: JobStatus | undefined;
  maxAttempts?: number | undefined;
  availableAt?: string | undefined;
}

interface JobRow {
  id: string;
  run_id: string;
  stage: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  worker_id: string | null;
  lease_until: string | null;
  last_heartbeat_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    workerId: row.worker_id,
    leaseUntil: row.lease_until,
    lastHeartbeatAt: row.last_heartbeat_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JobRepository {
  constructor(private db: Database) {}

  createJob(input: CreateJobInput): JobRecord {
    const id = input.id || `job-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const availableAt = input.availableAt || now;
    const status = input.status || "pending";
    const maxAttempts = input.maxAttempts ?? 3;

    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, run_id, stage, status, attempts, max_attempts,
        available_at, worker_id, lease_until, last_heartbeat_at, error,
        created_at, updated_at
      ) VALUES (
        $id, $runId, $stage, $status, 0, $maxAttempts,
        $availableAt, NULL, NULL, NULL, NULL,
        $now, $now
      )
      RETURNING *;
    `);

    const row = stmt.get({
      $id: id,
      $runId: input.runId,
      $stage: input.stage,
      $status: status,
      $maxAttempts: maxAttempts,
      $availableAt: availableAt,
      $now: now,
    }) as JobRow;

    return rowToJobRecord(row);
  }

  getJob(id: string): JobRecord | null {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE id = ?;");
    const row = stmt.get(id) as JobRow | null;
    return row ? rowToJobRecord(row) : null;
  }

  listJobsForRun(runId: string): JobRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at ASC;",
    );
    const rows = stmt.all(runId) as JobRow[];
    return rows.map(rowToJobRecord);
  }

  /**
   * Atomically claims the next claimable job for the given worker.
   * Only claims jobs whose parent run has an active executable status.
   */
  claimNextJob(
    workerId: string,
    leaseDurationMs: number,
    nowMs = Date.now(),
  ): JobRecord | null {
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();

    const claimQuery = `
      UPDATE jobs
      SET status = 'claimed',
          worker_id = $workerId,
          lease_until = $leaseUntil,
          last_heartbeat_at = $now,
          attempts = attempts + 1,
          updated_at = $now
      WHERE id = (
        SELECT j.id FROM jobs j
        JOIN runs r ON j.run_id = r.id
        WHERE (j.status = 'pending' OR (j.status = 'claimed' AND j.lease_until < $now))
          AND j.available_at <= $now
          AND j.attempts < j.max_attempts
          AND r.status IN (${executableStatusesSql})
        ORDER BY j.created_at ASC
        LIMIT 1
      )
      RETURNING *;
    `;

    const row = this.db.prepare(claimQuery).get({
      $workerId: workerId,
      $leaseUntil: leaseUntil,
      $now: now,
    }) as JobRow | null;

    return row ? rowToJobRecord(row) : null;
  }

  /**
   * Atomically claims the next pending job for a specific run.
   */
  claimJobForRun(
    runId: string,
    workerId: string,
    leaseDurationMs: number,
    nowMs = Date.now(),
  ): JobRecord | null {
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();

    const claimQuery = `
      UPDATE jobs
      SET status = 'claimed',
          worker_id = $workerId,
          lease_until = $leaseUntil,
          last_heartbeat_at = $now,
          attempts = attempts + 1,
          updated_at = $now
      WHERE id = (
        SELECT j.id FROM jobs j
        JOIN runs r ON j.run_id = r.id
        WHERE j.run_id = $runId
          AND (j.status = 'pending' OR (j.status = 'claimed' AND j.lease_until < $now))
          AND j.available_at <= $now
          AND j.attempts < j.max_attempts
          AND r.status IN (${executableStatusesSql})
        ORDER BY j.created_at ASC
        LIMIT 1
      )
      RETURNING *;
    `;

    const row = this.db.prepare(claimQuery).get({
      $runId: runId,
      $workerId: workerId,
      $leaseUntil: leaseUntil,
      $now: now,
    }) as JobRow | null;

    return row ? rowToJobRecord(row) : null;
  }

  /**
   * Extends the lease of an actively claimed job.
   */
  renewLease(
    jobId: string,
    workerId: string,
    leaseDurationMs: number,
    nowMs = Date.now(),
  ): boolean {
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();

    const stmt = this.db.prepare(`
      UPDATE jobs
      SET lease_until = $leaseUntil,
          last_heartbeat_at = $now,
          updated_at = $now
      WHERE id = $jobId AND worker_id = $workerId AND status = 'claimed'
      RETURNING id;
    `);

    const row = stmt.get({
      $jobId: jobId,
      $workerId: workerId,
      $leaseUntil: leaseUntil,
      $now: now,
    });

    return !!row;
  }

  /**
   * Marks a job as completed successfully.
   */
  private transitionClaimedJob(
    jobId: string,
    workerId: string,
    targetStatus: "completed" | "pending",
    newWorkerId: string | null,
    now = new Date().toISOString(),
  ): boolean {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = $targetStatus,
          worker_id = $newWorkerId,
          lease_until = NULL,
          updated_at = $now
      WHERE id = $jobId AND worker_id = $workerId AND status = 'claimed'
      RETURNING id;
    `);

    const row = stmt.get({
      $targetStatus: targetStatus,
      $newWorkerId: newWorkerId,
      $jobId: jobId,
      $workerId: workerId,
      $now: now,
    });
    return !!row;
  }

  /**
   * Marks a job as completed successfully.
   */
  completeJob(jobId: string, workerId: string): boolean {
    return this.transitionClaimedJob(jobId, workerId, "completed", workerId);
  }

  /**
   * Handles job failure, enforcing bounded retries.
   * If attempts < maxAttempts, returns to 'pending' with a backoff delay.
   * Otherwise, enters terminal 'failed' status.
   */
  failJob(
    jobId: string,
    workerId: string,
    errorMsg: string,
    retryDelayMs = 5000,
  ): { willRetry: boolean; attempts: number } {
    const current = this.getJob(jobId);
    if (!current) {
      throw new Error(`Job "${jobId}" not found.`);
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const willRetry = current.attempts < current.maxAttempts;

    if (willRetry) {
      const availableAt = new Date(nowMs + retryDelayMs).toISOString();
      const res = this.db
        .prepare(
          `
          UPDATE jobs
          SET status = 'pending',
              worker_id = NULL,
              lease_until = NULL,
              available_at = $availableAt,
              error = $error,
              updated_at = $now
          WHERE id = $jobId AND worker_id = $workerId AND status = 'claimed'
        `,
        )
        .run({
          $jobId: jobId,
          $workerId: workerId,
          $availableAt: availableAt,
          $error: errorMsg,
          $now: now,
        });
      if (res.changes === 0) {
        throw new Error(
          `Job "${jobId}" cannot be mutated: worker "${workerId}" does not hold a valid lease.`,
        );
      }
    } else {
      this.markClaimedJobFailed(jobId, workerId, errorMsg, now);
    }

    return { willRetry, attempts: current.attempts };
  }

  /**
   * Ends a claimed job as failed with no retry. Used when a stage's outcome is a verdict
   * (a rejected review), not a fault worth another attempt (#181).
   */
  rejectJob(jobId: string, workerId: string, reason: string): void {
    this.markClaimedJobFailed(
      jobId,
      workerId,
      reason,
      new Date().toISOString(),
    );
  }

  private markClaimedJobFailed(
    jobId: string,
    workerId: string,
    errorMsg: string,
    now: string,
  ): void {
    const res = this.db
      .prepare(
        `
        UPDATE jobs
        SET status = 'failed',
            worker_id = NULL,
            lease_until = NULL,
            error = $error,
            updated_at = $now
        WHERE id = $jobId AND worker_id = $workerId AND status = 'claimed'
      `,
      )
      .run({
        $jobId: jobId,
        $workerId: workerId,
        $error: errorMsg,
        $now: now,
      });
    if (res.changes === 0) {
      throw new Error(
        `Job "${jobId}" cannot be mutated: worker "${workerId}" does not hold a valid lease.`,
      );
    }
  }

  /**
   * Voluntarily releases an active lease back to 'pending' (e.g. during graceful shutdown).
   */
  releaseLease(jobId: string, workerId: string, now?: string): boolean {
    return this.transitionClaimedJob(jobId, workerId, "pending", null, now);
  }

  /**
   * Finds all jobs currently claimed whose lease has expired (XFM-36).
   */
  findStaleClaimedJobs(nowISO?: string): JobRecord[] {
    const now = nowISO || new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'claimed' AND lease_until < ?
      ORDER BY created_at ASC;
    `);
    const rows = stmt.all(now) as JobRow[];
    return rows.map(rowToJobRecord);
  }

  /**
   * Re-queues a claimed job whose lease has expired back to 'pending' (recovery from a dead
   * worker, XFM-36). A job renewed in the meantime is left alone and false is returned.
   */
  requeueJob(jobId: string, now = new Date().toISOString()): boolean {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'pending',
          worker_id = NULL,
          lease_until = NULL,
          updated_at = $now
      WHERE id = $jobId AND status = 'claimed'
      RETURNING id;
    `);
    const row = stmt.get({ $jobId: jobId, $now: now });
    return !!row;
  }

  /**
   * Fails a claimed job whose lease expired with its retry budget spent. Unlike
   * `failJob`, the caller does not hold the lease, so no worker check applies.
   * Only an expired lease can be failed: a job renewed since the caller read it
   * is left alone. Returns false when nothing changed.
   */
  failExhaustedJob(
    jobId: string,
    error: string,
    now = new Date().toISOString(),
  ): boolean {
    const row = this.db
      .prepare(
        `
        UPDATE jobs
        SET status = 'failed',
            worker_id = NULL,
            lease_until = NULL,
            error = $error,
            updated_at = $now
        WHERE id = $jobId AND status = 'claimed' AND lease_until < $now
        RETURNING id;
      `,
      )
      .get({ $jobId: jobId, $error: error, $now: now });
    return !!row;
  }

  /**
   * Finds all active (pending or claimed) jobs for a given run (XFM-36).
   */
  findActiveJobsForRun(runId: string): JobRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE run_id = ? AND status IN ('pending', 'claimed')
      ORDER BY created_at ASC;
    `);
    const rows = stmt.all(runId) as JobRow[];
    return rows.map(rowToJobRecord);
  }

  /**
   * Finds the currently claimed job for a run, returning its workerId and job record (Phase 1, Item 7).
   */
  findActiveJobForRun(runId: string): JobRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE run_id = ? AND status = 'claimed'
      ORDER BY created_at ASC
      LIMIT 1;
    `);
    const row = stmt.get(runId) as JobRow | null;
    return row ? rowToJobRecord(row) : null;
  }

  /**
   * Terminally cancels all active jobs for a run (e.g. when run is stopped or abandoned) (XFM-37).
   */
  cancelJobsForRun(runId: string, reason = "Run stopped."): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE jobs
        SET status = 'cancelled',
            worker_id = NULL,
            lease_until = NULL,
            error = $error,
            updated_at = $now
        WHERE run_id = $runId AND status IN ('pending', 'claimed');
      `,
      )
      .run({
        $runId: runId,
        $error: reason,
        $now: now,
      });
  }
}
