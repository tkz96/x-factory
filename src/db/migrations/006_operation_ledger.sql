-- Migration 006: Durable operation ledger for external mutation idempotency (XFM-33)
-- status: 'pending', 'completed', 'failed'
-- external_id: e.g. PR URL, PR number, commit SHA
-- result: JSON serialized payload
CREATE TABLE IF NOT EXISTS operation_ledger (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,
  status       TEXT NOT NULL,
  external_id  TEXT,
  result       TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(run_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_operation_ledger_run_op ON operation_ledger(run_id, operation);
