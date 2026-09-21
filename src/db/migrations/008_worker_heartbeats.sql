-- src/db/migrations/008_worker_heartbeats.sql — Durable worker heartbeats table for liveness and readiness (XFM-38).

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id       TEXT PRIMARY KEY,
  pid             INTEGER,
  hostname        TEXT,
  last_heartbeat  TEXT NOT NULL,
  started_at      TEXT NOT NULL
);
