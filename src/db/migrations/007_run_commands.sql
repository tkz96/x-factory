-- src/db/migrations/007_run_commands.sql — Durable operator commands table (XFM-36, XFM-37).

CREATE TABLE IF NOT EXISTS run_commands (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(id),
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

CREATE INDEX IF NOT EXISTS idx_run_commands_pending
  ON run_commands(status, created_at)
  WHERE status = 'pending';
