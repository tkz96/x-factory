// src/db/command-repository.ts — Durable operator commands repository (XFM-36, XFM-37).

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type CommandType = "stop" | "steer" | "deliver";
export type CommandStatus = "pending" | "claimed" | "completed" | "failed";

export interface CommandRecord {
  id: string;
  runId: string;
  command: CommandType;
  payload: Record<string, unknown> | null;
  idempotencyKey: string | null;
  targetWorkerId: string | null;
  status: CommandStatus;
  workerId: string | null;
  leaseUntil: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface CommandRow {
  id: string;
  run_id: string;
  command: string;
  payload: string | null;
  idempotency_key: string | null;
  target_worker_id: string | null;
  status: string;
  worker_id: string | null;
  lease_until: string | null;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: string | null;
  created_at: string;
  processed_at: string | null;
}

function rowToRecord(row: CommandRow): CommandRecord {
  let parsedPayload: Record<string, unknown> | null = null;
  if (row.payload) {
    try {
      parsedPayload = JSON.parse(row.payload);
    } catch {
      parsedPayload = null;
    }
  }

  return {
    id: row.id,
    runId: row.run_id,
    command: row.command as CommandType,
    payload: parsedPayload,
    idempotencyKey: row.idempotency_key,
    targetWorkerId: row.target_worker_id,
    status: row.status as CommandStatus,
    workerId: row.worker_id,
    leaseUntil: row.lease_until,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
    result: row.result,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

export interface InsertCommandInput {
  id?: string | undefined;
  runId: string;
  command: CommandType;
  payload?: Record<string, unknown> | null | undefined;
  idempotencyKey?: string | null | undefined;
  targetWorkerId?: string | null | undefined;
  maxAttempts?: number | undefined;
}

export class CommandRepository {
  constructor(private db: Database) {}

  /**
   * Inserts a new command, or recovers/resets a previously failed command with the same idempotency key.
   */
  insertOrRetryCommand(
    input: InsertCommandInput,
    txDb?: Database,
  ): CommandRecord {
    const conn = txDb || this.db;
    const now = new Date().toISOString();

    if (input.idempotencyKey) {
      const existing = conn
        .prepare<CommandRow, [string]>(
          "SELECT * FROM run_commands WHERE idempotency_key = ?;",
        )
        .get(input.idempotencyKey);

      if (existing) {
        if (existing.status === "failed") {
          // Retry failed command: reset to pending
          const updated = conn
            .prepare<CommandRow, { $key: string; $now: string }>(`
              UPDATE run_commands
              SET status = 'pending',
                  attempts = 0,
                  error = NULL,
                  result = NULL,
                  worker_id = NULL,
                  lease_until = NULL,
                  created_at = $now,
                  processed_at = NULL
              WHERE idempotency_key = $key AND status = 'failed'
              RETURNING *;
            `)
            .get({ $key: input.idempotencyKey, $now: now });
          if (updated) return rowToRecord(updated);
        }
        return rowToRecord(existing);
      }
    }

    const id = input.id || `cmd-${randomUUID().slice(0, 8)}`;
    const serializedPayload = input.payload
      ? JSON.stringify(input.payload)
      : null;

    const row = conn
      .prepare<
        CommandRow,
        {
          $id: string;
          $runId: string;
          $command: string;
          $payload: string | null;
          $key: string | null;
          $targetWorkerId: string | null;
          $maxAttempts: number;
          $now: string;
        }
      >(`
        INSERT INTO run_commands (
          id, run_id, command, payload, idempotency_key, target_worker_id,
          status, attempts, max_attempts, created_at
        ) VALUES (
          $id, $runId, $command, $payload, $key, $targetWorkerId,
          'pending', 0, $maxAttempts, $now
        )
        ON CONFLICT(idempotency_key) DO UPDATE SET
          attempts = attempts -- no-op, returns row
        RETURNING *;
      `)
      .get({
        $id: id,
        $runId: input.runId,
        $command: input.command,
        $payload: serializedPayload,
        $key: input.idempotencyKey ?? null,
        $targetWorkerId: input.targetWorkerId ?? null,
        $maxAttempts: input.maxAttempts ?? 3,
        $now: now,
      });

    if (!row) {
      throw new Error(`Failed to insert command for run ${input.runId}`);
    }

    return rowToRecord(row);
  }

  /**
   * Retrieves a command by ID.
   */
  getCommand(id: string, txDb?: Database): CommandRecord | null {
    const conn = txDb || this.db;
    const row = conn
      .prepare<CommandRow, [string]>("SELECT * FROM run_commands WHERE id = ?;")
      .get(id);
    return row ? rowToRecord(row) : null;
  }

  /**
   * Claims all eligible pending commands for the given worker, resolving stale target workers.
   */
  claimPendingCommands(
    workerId: string,
    leaseDurationMs = 30000,
    heartbeatTtlMs = 30000,
    txDb?: Database,
  ): CommandRecord[] {
    const conn = txDb || this.db;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();
    const cutoff = new Date(nowMs - heartbeatTtlMs).toISOString();

    // 1. Resolve stale targeted commands (where target is a different worker)
    const pendingTargeted = conn
      .prepare<CommandRow & { target_heartbeat: string | null }, [string]>(`
        SELECT c.*, w.last_heartbeat as target_heartbeat
        FROM run_commands c
        LEFT JOIN worker_heartbeats w ON c.target_worker_id = w.worker_id
        WHERE c.status = 'pending'
          AND c.target_worker_id IS NOT NULL
          AND c.target_worker_id != ?;
      `)
      .all(workerId);

    for (const cmd of pendingTargeted) {
      const isDead = !cmd.target_heartbeat || cmd.target_heartbeat <= cutoff;
      if (isDead) {
        if (cmd.command === "stop") {
          conn
            .prepare(`
              UPDATE run_commands
              SET status = 'completed',
                  result = 'Target worker dead; run already stopped',
                  processed_at = $now
              WHERE id = $id AND status = 'pending';
            `)
            .run({ $id: cmd.id, $now: now });
        } else if (cmd.command === "steer") {
          conn
            .prepare(`
              UPDATE run_commands
              SET status = 'failed',
                  error = 'Target worker dead; steer session lost',
                  processed_at = $now
              WHERE id = $id AND status = 'pending';
            `)
            .run({ $id: cmd.id, $now: now });
        }
      }
    }

    // 2. Claim claimable commands:
    // Either target_worker_id is null OR matches this worker.
    // Also include expired claimed commands (except steer which is at-most-once and fails on expiry).
    const claimQuery = `
      UPDATE run_commands
      SET status = 'claimed',
          worker_id = $workerId,
          lease_until = $leaseUntil,
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM run_commands
        WHERE (
          status = 'pending'
          OR (status = 'claimed' AND lease_until < $now AND command != 'steer' AND attempts < max_attempts)
        )
        AND (target_worker_id IS NULL OR target_worker_id = $workerId)
        ORDER BY created_at ASC
      )
      RETURNING *;
    `;

    const rows = conn
      .prepare<
        CommandRow,
        {
          $workerId: string;
          $leaseUntil: string;
          $now: string;
        }
      >(claimQuery)
      .all({
        $workerId: workerId,
        $leaseUntil: leaseUntil,
        $now: now,
      });

    return rows.map(rowToRecord);
  }

  /**
   * Finds the latest command of a given type for a run.
   */
  findCommandByRunAndType(
    runId: string,
    command: CommandType,
    txDb?: Database,
  ): CommandRecord | null {
    const conn = txDb || this.db;
    const row = conn
      .prepare<CommandRow, [string, string]>(
        "SELECT * FROM run_commands WHERE run_id = ? AND command = ? ORDER BY created_at DESC LIMIT 1;",
      )
      .get(runId, command);
    return row ? rowToRecord(row) : null;
  }

  /**
   * Marks a command as completed.
   */
  completeCommand(id: string, result?: unknown, txDb?: Database): boolean {
    const conn = txDb || this.db;
    const now = new Date().toISOString();
    const serializedResult =
      result !== undefined
        ? typeof result === "string"
          ? result
          : JSON.stringify(result)
        : null;

    const res = conn
      .prepare(`
        UPDATE run_commands
        SET status = 'completed',
            result = $result,
            processed_at = $now
        WHERE id = $id;
      `)
      .run({
        $id: id,
        $result: serializedResult,
        $now: now,
      });
    return res.changes > 0;
  }

  /**
   * Marks a command as failed.
   */
  failCommand(id: string, error: string, txDb?: Database): boolean {
    const conn = txDb || this.db;
    const now = new Date().toISOString();

    const cmd = this.getCommand(id, conn);
    if (!cmd) return false;

    const res = conn
      .prepare(`
        UPDATE run_commands
        SET status = 'failed',
            worker_id = NULL,
            lease_until = NULL,
            error = $error,
            processed_at = $now
        WHERE id = $id;
      `)
      .run({
        $id: id,
        $error: error,
        $now: now,
      });
    return res.changes > 0;
  }
}
