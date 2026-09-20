-- Migration 005: Durable stage attempts table (XFM-29, XFM-31)
CREATE TABLE IF NOT EXISTS stage_attempts (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  attempt     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL, -- 'running', 'completed', 'failed'
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  output      TEXT,          -- JSON serialized payload (diff summary, verification results, etc.)
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stage_attempts_run_stage ON stage_attempts(run_id, stage);
