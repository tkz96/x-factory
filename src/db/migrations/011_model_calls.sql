-- Migration 011: One row per model call, for the requests/day budget (#281).
-- The requests/day budget counts calls, not stage attempts: one stage can make
-- many calls (Understand, Plan and Review each prompt the model once), every 429
-- retry is another request, and the coding loop reports one call per iteration.
-- Cost stays on stage_attempts; this table records counting only.
-- called_at is the UTC timestamp of the call; a call belongs to the stage attempt
-- that made it when there is one.
CREATE TABLE IF NOT EXISTS model_calls (
  id               INTEGER PRIMARY KEY,
  connection_id    TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  stage_attempt_id TEXT REFERENCES stage_attempts(id) ON DELETE CASCADE,
  called_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_calls_model_called_at
  ON model_calls(connection_id, model_id, called_at);
