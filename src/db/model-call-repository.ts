// src/db/model-call-repository.ts — Durable per-call counting for the
// requests/day budget (#281).
//
// One row per model call the worker makes through the model gateway. The budget
// counts calls, not stage attempts: a stage can make many calls, every retry
// after a 429 is another request and the coding loop reports one call per
// iteration. Cost is not here — the USD budget keeps summing `stage_attempts`.

import type { Database } from "bun:sqlite";
import { modelKey } from "../shared/model-key.js";
import { startOfUtcDay } from "./utc-day.js";

export interface ModelCallRecord {
  connectionId: string;
  modelId: string;
  /** The stage attempt whose work made the call, when there is one. */
  stageAttemptId?: string | null | undefined;
  /** When the call was made; defaults to now. */
  at?: Date | undefined;
}

export class ModelCallRepository {
  constructor(private db: Database) {}

  /** Records one model call, as it is about to be sent. */
  record(call: ModelCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO model_calls (connection_id, model_id, stage_attempt_id, called_at)
         VALUES ($connectionId, $modelId, $stageAttemptId, $calledAt)`,
      )
      .run({
        $connectionId: call.connectionId,
        $modelId: call.modelId,
        $stageAttemptId: call.stageAttemptId ?? null,
        $calledAt: (call.at ?? new Date()).toISOString(),
      });
  }

  /**
   * How many calls this model made today, by default since the start of the
   * current UTC day.
   */
  countForModel(
    connectionId: string,
    modelId: string,
    options?: { since?: string | undefined; now?: Date | undefined },
  ): number {
    const since = options?.since ?? startOfUtcDay(options?.now);
    const row = this.db
      .prepare<
        { calls: number },
        { $connectionId: string; $modelId: string; $since: string }
      >(
        `SELECT COUNT(*) AS calls
         FROM model_calls
         WHERE connection_id = $connectionId
           AND model_id = $modelId
           AND called_at >= $since`,
      )
      .get({
        $connectionId: connectionId,
        $modelId: modelId,
        $since: since,
      });
    return row?.calls ?? 0;
  }

  /** Today's call counts for every model, keyed `${connectionId}:${modelId}`. */
  countsByModel(options?: {
    since?: string | undefined;
    now?: Date | undefined;
  }): Map<string, number> {
    const since = options?.since ?? startOfUtcDay(options?.now);
    const rows = this.db
      .prepare<
        { connection_id: string; model_id: string; calls: number },
        { $since: string }
      >(
        `SELECT connection_id, model_id, COUNT(*) AS calls
         FROM model_calls
         WHERE called_at >= $since
         GROUP BY connection_id, model_id`,
      )
      .all({ $since: since });

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(modelKey(row.connection_id, row.model_id), row.calls);
    }
    return counts;
  }
}
