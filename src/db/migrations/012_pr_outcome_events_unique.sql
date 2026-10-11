-- Migration 012: Ensure at most one PR outcome event (pr_merged or pr_closed) per run (#271).
-- A pull request opened by a run can only reach one outcome: merged or closed.
-- A repeat detection is a no-op, enforced atomically at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_pr_outcome
  ON run_events(run_id)
  WHERE type IN ('pr_merged', 'pr_closed');
