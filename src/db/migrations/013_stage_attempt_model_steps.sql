-- Migration 013: One row per model step of a stage attempt.
-- An attempt can use more than one model: the execute stage codes with the
-- Builder and then reviews with the Reviewer. With one model per attempt row,
-- the review overwrote the coding model. Each step now keeps its own role,
-- connection, model and usage, as they were at the time. `step` names the work
-- ("understand", "plan", "execute", "review"), which is the stage itself except
-- for the review inside the execute stage.
CREATE TABLE IF NOT EXISTS stage_attempt_models (
  id               INTEGER PRIMARY KEY,
  stage_attempt_id TEXT NOT NULL REFERENCES stage_attempts(id) ON DELETE CASCADE,
  step             TEXT NOT NULL,
  model_role       TEXT NOT NULL,
  connection_id    TEXT NOT NULL,
  connection_name  TEXT NOT NULL,
  api_type         TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  cost_usd         REAL
);

CREATE INDEX IF NOT EXISTS idx_stage_attempt_models_attempt
  ON stage_attempt_models(stage_attempt_id);

CREATE INDEX IF NOT EXISTS idx_stage_attempt_models_model
  ON stage_attempt_models(connection_id, model_id);

-- Earlier attempts recorded one model each; keep it as that attempt's one step.
INSERT INTO stage_attempt_models (
  stage_attempt_id, step, model_role, connection_id, connection_name,
  api_type, model_id, tokens_in, tokens_out, cost_usd
)
SELECT id, stage, COALESCE(model_role, 'builder'), COALESCE(connection_id, ''),
       COALESCE(connection_name, ''), COALESCE(api_type, ''), model_id,
       tokens_in, tokens_out, cost_usd
FROM stage_attempts
WHERE model_id IS NOT NULL;

ALTER TABLE stage_attempts DROP COLUMN model_role;
ALTER TABLE stage_attempts DROP COLUMN connection_id;
ALTER TABLE stage_attempts DROP COLUMN connection_name;
ALTER TABLE stage_attempts DROP COLUMN api_type;
ALTER TABLE stage_attempts DROP COLUMN model_id;
ALTER TABLE stage_attempts DROP COLUMN tokens_in;
ALTER TABLE stage_attempts DROP COLUMN tokens_out;
ALTER TABLE stage_attempts DROP COLUMN cost_usd;
