// src/db/stage-attempt-repository.ts — Durable persistence for stage attempts (XFM-29, XFM-31).

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { modelKey } from "../shared/model-key.js";
import type {
  ModelRoleName,
  ModelUsage,
  ModelUse,
  StageModelUse,
} from "../shared/types.js";
import { parseJsonColumn, serializeJsonColumn } from "./row-codec.js";
import { startOfUtcDay } from "./utc-day.js";

/** The model columns of a stage attempt row (#279). */
interface AttemptModelRow {
  run_id: string;
  stage: string;
  attempt: number;
  started_at: string;
  model_role: string | null;
  connection_id: string | null;
  connection_name: string | null;
  api_type: string | null;
  model_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

function rowToModelUse(row: AttemptModelRow): StageModelUse {
  const use: StageModelUse = {
    role: (row.model_role ?? "builder") as ModelRoleName,
    connectionId: row.connection_id ?? "",
    connectionName: row.connection_name ?? "",
    apiType: row.api_type ?? "",
    modelId: row.model_id ?? "",
    stage: row.stage,
    attempt: row.attempt,
    startedAt: row.started_at,
  };
  if (row.tokens_in !== null) use.tokensIn = row.tokens_in;
  if (row.tokens_out !== null) use.tokensOut = row.tokens_out;
  if (row.cost_usd !== null) use.costUsd = row.cost_usd;
  return use;
}

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
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    attempt: row.attempt,
    status: row.status as StageAttemptStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    // A malformed output degrades to its raw text; only this field is lost.
    // Free-form diagnostic payloads keep the corrupt text so operators can
    // see what was stored (the rationale lives in src/db/row-codec.ts).
    output: parseJsonColumn(row.output, row.output, {
      table: "stage_attempts",
      column: "output",
      rowId: row.id,
    }),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class StageAttemptRepository {
  constructor(private db: Database) {}

  /**
   * Records the start of a stage attempt with status 'running'.
   */
  recordStart(
    runId: string,
    stage: string,
    attempt?: number | undefined,
  ): StageAttemptRecord {
    const id = `att-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let attemptNum = attempt;
    if (attemptNum === undefined) {
      const latest = this.getLatestAttempt(runId, stage);
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

    const stmt = this.db.prepare<
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
  recordCompletion(id: string, output?: unknown): StageAttemptRecord {
    const now = new Date().toISOString();
    const serializedOutput = serializeJsonColumn(output);

    const query = `
      UPDATE stage_attempts
      SET status = 'completed',
          finished_at = $now,
          output = $output,
          updated_at = $now
      WHERE id = $id
      RETURNING *;
    `;

    const stmt = this.db.prepare<
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
    now = new Date().toISOString(),
  ): StageAttemptRecord {
    const query = `
      UPDATE stage_attempts
      SET status = $status,
          finished_at = $now,
          error = $error,
          updated_at = $now
      WHERE id = $id
      RETURNING *;
    `;

    const stmt = this.db.prepare<
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

  recordFailure(id: string, error: string, now?: string): StageAttemptRecord {
    return this.recordTerminalStatus(id, "failed", error, now);
  }

  /**
   * Records cancellation of a stage attempt.
   */
  recordCancellation(id: string, reason: string): StageAttemptRecord {
    return this.recordTerminalStatus(id, "cancelled", reason);
  }

  /**
   * Lists all stage attempts for a run ordered chronologically.
   */
  listForRun(runId: string): StageAttemptRecord[] {
    const query = `
      SELECT * FROM stage_attempts
      WHERE run_id = $runId
      ORDER BY started_at ASC, rowid ASC;
    `;

    const stmt = this.db.prepare<StageAttemptRow, { $runId: string }>(query);
    const rows = stmt.all({ $runId: runId });
    return rows.map(rowToRecord);
  }

  /**
   * Retrieves the most recent attempt for a given stage in a run.
   */
  getLatestAttempt(runId: string, stage: string): StageAttemptRecord | null {
    const query = `
      SELECT * FROM stage_attempts
      WHERE run_id = $runId AND stage = $stage
      ORDER BY attempt DESC
      LIMIT 1;
    `;

    const stmt = this.db.prepare<
      StageAttemptRow,
      { $runId: string; $stage: string }
    >(query);
    const row = stmt.get({ $runId: runId, $stage: stage });
    return row ? rowToRecord(row) : null;
  }

  /** Records the model an attempt runs on, as it is now (#279). */
  recordModel(id: string, model: ModelUse): void {
    this.db
      .prepare(
        `UPDATE stage_attempts
         SET model_role = $role, connection_id = $connectionId,
             connection_name = $connectionName, api_type = $apiType,
             model_id = $modelId, updated_at = $now
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $role: model.role,
        $connectionId: model.connectionId,
        $connectionName: model.connectionName,
        $apiType: model.apiType,
        $modelId: model.modelId,
        $now: new Date().toISOString(),
      });
  }

  /** Adds reported tokens and cost to an attempt's running totals (#279). */
  addUsage(id: string, usage: ModelUsage): void {
    this.db
      .prepare(
        `UPDATE stage_attempts
         SET tokens_in = CASE WHEN $tokensIn IS NULL THEN tokens_in ELSE COALESCE(tokens_in, 0) + $tokensIn END,
             tokens_out = CASE WHEN $tokensOut IS NULL THEN tokens_out ELSE COALESCE(tokens_out, 0) + $tokensOut END,
             cost_usd = CASE WHEN $costUsd IS NULL THEN cost_usd ELSE COALESCE(cost_usd, 0) + $costUsd END,
             updated_at = $now
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $tokensIn: usage.tokensIn ?? null,
        $tokensOut: usage.tokensOut ?? null,
        $costUsd: usage.costUsd ?? null,
        $now: new Date().toISOString(),
      });
  }

  /** The models a run's attempts used, oldest first; attempts with no model are left out (#279). */
  listModelsForRun(runId: string): StageModelUse[] {
    return this.listModels("WHERE run_id = $runId AND model_id IS NOT NULL", {
      $runId: runId,
    });
  }

  /** Every run's attempt models, grouped by run ID, for listing runs (#279). */
  listModelsByRun(): Map<string, StageModelUse[]> {
    const byRun = new Map<string, StageModelUse[]>();
    for (const row of this.modelRows("WHERE model_id IS NOT NULL", {})) {
      const list = byRun.get(row.run_id) ?? [];
      list.push(rowToModelUse(row));
      byRun.set(row.run_id, list);
    }
    return byRun;
  }

  /**
   * Today's cost for a specific model, summed from the attempts that reported it (#281).
   * By default, sums attempts started since the beginning of the current UTC day.
   * Call counts are not here: the requests/day budget counts `model_calls` (#281).
   */
  getDailyCostForModel(
    connectionId: string,
    modelId: string,
    options?: { since?: string | undefined; now?: Date | undefined },
  ): number {
    const since = options?.since ?? startOfUtcDay(options?.now);
    const row = this.db
      .prepare<
        { spend_usd: number | null },
        { $connectionId: string; $modelId: string; $since: string }
      >(
        `SELECT SUM(COALESCE(cost_usd, 0.0)) AS spend_usd
         FROM stage_attempts
         WHERE connection_id = $connectionId
           AND model_id = $modelId
           AND started_at >= $since`,
      )
      .get({
        $connectionId: connectionId,
        $modelId: modelId,
        $since: since,
      });
    return row?.spend_usd ?? 0;
  }

  /**
   * Today's cost for all models, keyed `${connection_id}:${model_id}` (#281).
   */
  getDailyCostByModel(options?: {
    since?: string | undefined;
    now?: Date | undefined;
  }): Map<string, number> {
    const since = options?.since ?? startOfUtcDay(options?.now);
    const rows = this.db
      .prepare<
        { connection_id: string; model_id: string; spend_usd: number | null },
        { $since: string }
      >(
        `SELECT connection_id,
                model_id,
                SUM(COALESCE(cost_usd, 0.0)) AS spend_usd
         FROM stage_attempts
         WHERE connection_id IS NOT NULL
           AND model_id IS NOT NULL
           AND started_at >= $since
         GROUP BY connection_id, model_id`,
      )
      .all({ $since: since });

    const costs = new Map<string, number>();
    for (const row of rows) {
      costs.set(modelKey(row.connection_id, row.model_id), row.spend_usd ?? 0);
    }
    return costs;
  }

  private listModels(
    where: string,
    params: Record<string, string>,
  ): StageModelUse[] {
    return this.modelRows(where, params).map(rowToModelUse);
  }

  private modelRows(
    where: string,
    params: Record<string, string>,
  ): AttemptModelRow[] {
    return this.db
      .prepare<AttemptModelRow, Record<string, string>>(
        `SELECT run_id, stage, attempt, started_at, model_role, connection_id,
                connection_name, api_type, model_id, tokens_in, tokens_out, cost_usd
         FROM stage_attempts ${where}
         ORDER BY started_at ASC, rowid ASC`,
      )
      .all(params);
  }
}
