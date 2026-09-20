// src/db/operation-ledger-repository.ts — Durable operation ledger for external mutation idempotency (XFM-33).

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type OperationStatus = "pending" | "completed" | "failed";

export interface OperationLedgerRow {
  id: string;
  run_id: string;
  operation: string;
  status: string;
  external_id: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationLedgerRecord {
  id: string;
  runId: string;
  operation: string;
  status: OperationStatus;
  externalId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToRecord(row: OperationLedgerRow): OperationLedgerRecord {
  let parsedResult: unknown = null;
  if (row.result) {
    try {
      parsedResult = JSON.parse(row.result);
    } catch {
      parsedResult = row.result;
    }
  }

  return {
    id: row.id,
    runId: row.run_id,
    operation: row.operation,
    status: row.status as OperationStatus,
    externalId: row.external_id,
    result: parsedResult,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OperationLedgerRepository {
  constructor(private db: Database) {}

  /**
   * Retrieves an operation record for a run by operation key.
   */
  getOperation(runId: string, operation: string): OperationLedgerRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM operation_ledger
      WHERE run_id = ? AND operation = ?;
    `);
    const row = stmt.get(runId, operation) as OperationLedgerRow | null;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Lists all recorded operations for a run.
   */
  listForRun(runId: string): OperationLedgerRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM operation_ledger
      WHERE run_id = ?
      ORDER BY created_at ASC;
    `);
    const rows = stmt.all(runId) as OperationLedgerRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Internal upsert helper consolidating SQL statement preparation and parameter binding.
   */
  private upsertEntry(
    runId: string,
    operation: string,
    status: OperationStatus,
    options: {
      externalId?: string | null | undefined;
      result?: unknown;
      error?: string | null | undefined;
    } = {},
  ): OperationLedgerRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const serializedResult =
      options.result !== undefined && options.result !== null
        ? JSON.stringify(options.result)
        : null;

    const stmt = this.db.prepare(`
      INSERT INTO operation_ledger (
        id, run_id, operation, status, external_id, result, error, created_at, updated_at
      ) VALUES (
        $id, $runId, $operation, $status, $externalId, $result, $error, $now, $now
      )
      ON CONFLICT(run_id, operation) DO UPDATE SET
        status = $status,
        external_id = $externalId,
        result = $result,
        error = $error,
        updated_at = $now
      RETURNING *;
    `);

    const row = stmt.get({
      $id: id,
      $runId: runId,
      $operation: operation,
      $status: status,
      $externalId: options.externalId ?? null,
      $result: serializedResult,
      $error: options.error ?? null,
      $now: now,
    }) as OperationLedgerRow;

    return rowToRecord(row);
  }

  /**
   * Records that an external mutation is pending.
   * If an entry exists, transitions status to 'pending'.
   */
  recordPending(runId: string, operation: string): OperationLedgerRecord {
    return this.upsertEntry(runId, operation, "pending");
  }

  /**
   * Records that an external mutation completed successfully.
   */
  recordCompleted(
    runId: string,
    operation: string,
    externalId?: string | null,
    result?: unknown,
  ): OperationLedgerRecord {
    return this.upsertEntry(runId, operation, "completed", {
      externalId,
      result,
    });
  }

  /**
   * Records that an external mutation failed.
   */
  recordFailed(
    runId: string,
    operation: string,
    error: string,
  ): OperationLedgerRecord {
    return this.upsertEntry(runId, operation, "failed", { error });
  }

  /**
   * Idempotently executes an external mutation.
   * If the operation was already completed for this run, returns the cached result.
   */
  async executeWithLedger<T>(
    runId: string,
    operation: string,
    fn: () => Promise<{ externalId?: string | null | undefined; result: T }>,
  ): Promise<T> {
    const existing = this.getOperation(runId, operation);
    if (
      existing &&
      existing.status === "completed" &&
      existing.result !== null
    ) {
      return existing.result as T;
    }

    this.recordPending(runId, operation);

    try {
      const outcome = await fn();
      this.recordCompleted(
        runId,
        operation,
        outcome.externalId,
        outcome.result,
      );
      return outcome.result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordFailed(runId, operation, errorMsg);
      throw err;
    }
  }
}
