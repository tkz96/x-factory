-- src/db/migrations/010_stage_attempt_models.sql — Record which model each stage attempt used (#279).
-- Each attempt keeps the role, connection and model it ran on, as they were at the
-- time, so later Settings changes never rewrite history; plus the tokens and cost
-- the provider reported, when it reported them.
ALTER TABLE stage_attempts ADD COLUMN model_role TEXT;
ALTER TABLE stage_attempts ADD COLUMN connection_id TEXT;
ALTER TABLE stage_attempts ADD COLUMN connection_name TEXT;
ALTER TABLE stage_attempts ADD COLUMN api_type TEXT;
ALTER TABLE stage_attempts ADD COLUMN model_id TEXT;
ALTER TABLE stage_attempts ADD COLUMN tokens_in INTEGER;
ALTER TABLE stage_attempts ADD COLUMN tokens_out INTEGER;
ALTER TABLE stage_attempts ADD COLUMN cost_usd REAL;
