-- Migration 003: Durable jobs table for worker claiming and lease management
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  worker_id TEXT,
  lease_until TEXT,
  last_heartbeat_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, available_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
