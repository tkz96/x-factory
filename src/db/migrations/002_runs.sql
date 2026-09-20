-- Migration 002: Durable runs table
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  ticket_title TEXT NOT NULL,
  ticket_description TEXT,
  ticket_acceptance_criteria TEXT NOT NULL,
  plan TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  artifacts_dir TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  implementation_context TEXT,
  verification TEXT,
  review TEXT,
  artifacts TEXT,
  diff TEXT,
  pull_request TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
