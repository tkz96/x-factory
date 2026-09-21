// src/db/stage-attempt-repository.ts — Durable persistence for stage attempts (XFM-29, XFM-31).

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type StageAttemptStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StageAttemptRecord {
  id: string;
  runId: string;
  stage: string;
  attempt: number;
  status: StageAttemptStatus;
  startedAt: string;
  finishedAt: string | null;
  output: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StageAttemptRow {
  id: string;
  run_id: string;
  stage: string;
  attempt: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  output: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: StageAttemptRow): StageAttemptRecord {
  let parsedOutput: unknown = null;
  if (row.output) {
    try {
      parsedOutput = JSON.parse(row.output);
    } catch {
      parsedOutput = row.output;
    }
  }

  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    attempt: row.attempt,
    status: row.status as StageAttemptStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    output: parsedOutput,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class StageAttemptRepository {
  constructor(private db: Database) {}

  private getDb(txDb?: Database): Database {
    return txDb ?? this.db;
  }

  /**
   * Records the start of a stage attempt with status 'running'.
   */
  recordStart(
    runId: string,
    stage: string,
    attempt?: number | undefined,
    txDb?: Database,
  ): StageAttemptRecord {
    const db = this.getDb(txDb);
    const id = `att-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let attemptNum = attempt;
    if (attemptNum === undefined) {
      const latest = this.getLatestAttempt(runId, stage, txDb);
      attemptNum = (latest?.attempt ?? 0) + 1;
    }

    const query = `
      INSERT INTO stage_attempts (
        id, run_id, stage, attempt, status, started_at, finished_at, output, error, created_at, updated_at
      ) VALUES (
        $id, $runId, $stage, $attempt, 'running', $now, NULL, NULL, NULL, $now, $now
      )
      RETURNING *;
    `;

    const stmt = db.prepare<
      StageAttemptRow,
      {
        $id: string;
        $runId: string;
        $stage: string;
        $attempt: number;
        $now: string;
      }
    >(query);

    const row = stmt.get({
      $id: id,
      $runId: runId,
      $stage: stage,
      $attempt: attemptNum,
      $now: now,
    });

    if (!row) {
      throw new Error(
        `Failed to record stage attempt start for run ${runId}, stage ${stage}`,
      );
    }

    return rowToRecord(row);
  }

  /**
   * Records the successful completion of a stage attempt.
   */
  recordCompletion(
    id: string,
    output?: unknown,
    txDb?: Database,
  ): StageAttemptRecord {
    const db = this.getDb(txDb);
    const now = new Date().toISOString();
    const serializedOutput =
      output !== undefined
        ? typeof output === "string"
          ? output
          : JSON.stringify(output)
        : null;

    const query = `
      UPDATE stage_attempts
      SET status = 'completed',
          finished_at = $now,
          output = $output,
          updated_at = $now
      WHERE id = $id
      RETURNING *;
    `;

    const stmt = db.prepare<
      StageAttemptRow,
      {
        $id: string;
        $output: string | null;
        $now: string;
      }
    >(query);

    const row = stmt.get({
      $id: id,
      $output: serializedOutput,
      $now: now,
    });

    if (!row) {
      throw new Error(`Stage attempt not found: ${id}`);
    }

    return rowToRecord(row);
  }

  /**
   * Records the failure of a stage attempt.
   */
  private recordTerminalStatus(
    id: string,
    status: "failed" | "cancelled",
    error: string,
    txDb?: Database,
  ): StageAttemptRecord {
    const db = this.getDb(txDb);
    const now = new Date().toISOString();

    const query = `
      UPDATE stage_attempts
      SET status = $status,
          finished_at = $now,
          error = $error,
          updated_at = $now
      WHERE id = $id
      RETURNING *;
    `;

    const stmt = db.prepare<
      StageAttemptRow,
      {
        $id: string;
        $status: string;
        $error: string;
        $now: string;
      }
    >(query);

    const row = stmt.get({
      $id: id,
      $status: status,
      $error: error,
      $now: now,
    });

    if (!row) {
      throw new Error(`Stage attempt not found: ${id}`);
    }

    return rowToRecord(row);
  }

  recordFailure(
    id: string,
    error: string,
    txDb?: Database,
  ): StageAttemptRecord {
    return this.recordTerminalStatus(id, "failed", error, txDb);
  }

  /**
   * Records cancellation of a stage attempt.
   */
  recordCancellation(
    id: string,
    reason: string,
    txDb?: Database,
  ): StageAttemptRecord {
    return this.recordTerminalStatus(id, "cancelled", reason, txDb);
  }

  /**
   * Lists all stage attempts for a run ordered chronologically.
   */
  listForRun(runId: string, txDb?: Database): StageAttemptRecord[] {
    const db = this.getDb(txDb);
    const query = `
      SELECT * FROM stage_attempts
      WHERE run_id = $runId
      ORDER BY started_at ASC, rowid ASC;
    `;

    const stmt = db.prepare<StageAttemptRow, { $runId: string }>(query);
    const rows = stmt.all({ $runId: runId });
    return rows.map(rowToRecord);
  }

  /**
   * Retrieves the most recent attempt for a given stage in a run.
   */
  getLatestAttempt(
    runId: string,
    stage: string,
    txDb?: Database,
  ): StageAttemptRecord | null {
    const db = this.getDb(txDb);
    const query = `
      SELECT * FROM stage_attempts
      WHERE run_id = $runId AND stage = $stage
      ORDER BY attempt DESC
      LIMIT 1;
    `;

    const stmt = db.prepare<
      StageAttemptRow,
      { $runId: string; $stage: string }
    >(query);
    const row = stmt.get({ $runId: runId, $stage: stage });
    return row ? rowToRecord(row) : null;
  }
}
