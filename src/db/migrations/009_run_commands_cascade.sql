-- src/db/migrations/009_run_commands_cascade.sql — Give run_commands.run_id ON DELETE CASCADE (#188).
-- run_commands was the only child table without it. SQLite cannot alter a foreign key
-- in place, so the table is rebuilt: create the new shape, copy every row, drop the old
-- table, rename, then recreate the partial index that the drop removed. Columns, the
-- UNIQUE(idempotency_key) constraint and all rows are preserved.
-- The migrator runs this inside a transaction, so foreign_keys cannot be toggled here.
-- Dropping run_commands is safe because no other table references it.

CREATE TABLE run_commands_new (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  command           TEXT NOT NULL,
  payload           TEXT,
  idempotency_key   TEXT,
  target_worker_id  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  worker_id         TEXT,
  lease_until       TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  error             TEXT,
  result            TEXT,
  created_at        TEXT NOT NULL,
  processed_at      TEXT,
  UNIQUE(idempotency_key)
);

INSERT INTO run_commands_new (
  id, run_id, command, payload, idempotency_key, target_worker_id, status,
  worker_id, lease_until, attempts, max_attempts, error, result, created_at, processed_at
)
SELECT
  id, run_id, command, payload, idempotency_key, target_worker_id, status,
  worker_id, lease_until, attempts, max_attempts, error, result, created_at, processed_at
FROM run_commands;

DROP TABLE run_commands;

ALTER TABLE run_commands_new RENAME TO run_commands;

CREATE INDEX IF NOT EXISTS idx_run_commands_pending
  ON run_commands(status, created_at)
  WHERE status = 'pending';
