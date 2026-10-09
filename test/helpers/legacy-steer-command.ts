// test/helpers/legacy-steer-command.ts — Inserts a pre-#167 `steer` row into run_commands.
//
// CommandRepository.CommandType no longer accepts "steer" after steering was
// removed (#167), so tests covering leftover rows from older databases write
// the row straight into SQLite exactly as it exists on disk.

import type { Database } from "bun:sqlite";

export interface LegacySteerCommandInput {
  id: string;
  runId: string;
  /** Serialized as payload: { message }. Defaults to "legacy steer". */
  message?: string | undefined;
  status?: "pending" | "claimed" | undefined;
  idempotencyKey?: string | null | undefined;
  targetWorkerId?: string | null | undefined;
  workerId?: string | null | undefined;
  leaseUntil?: string | null | undefined;
  attempts?: number | undefined;
  maxAttempts?: number | undefined;
}

export function insertLegacySteerCommand(
  db: Database,
  input: LegacySteerCommandInput,
): void {
  const columns = [
    "id",
    "run_id",
    "command",
    "payload",
    "status",
    "attempts",
    "max_attempts",
    "created_at",
  ];
  const values: Array<string | number> = [
    input.id,
    input.runId,
    "steer",
    JSON.stringify({ message: input.message ?? "legacy steer" }),
    input.status ?? "pending",
    input.attempts ?? 0,
    input.maxAttempts ?? 3,
    new Date().toISOString(),
  ];

  if (input.idempotencyKey != null) {
    columns.push("idempotency_key");
    values.push(input.idempotencyKey);
  }
  if (input.targetWorkerId != null) {
    columns.push("target_worker_id");
    values.push(input.targetWorkerId);
  }
  if (input.workerId != null) {
    columns.push("worker_id");
    values.push(input.workerId);
  }
  if (input.leaseUntil != null) {
    columns.push("lease_until");
    values.push(input.leaseUntil);
  }

  db.run(
    `INSERT INTO run_commands (${columns.join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")});`,
    values,
  );
}
