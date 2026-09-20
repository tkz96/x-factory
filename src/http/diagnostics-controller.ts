// src/http/diagnostics-controller.ts — Endpoints for liveness, readiness, and runtime diagnostics (XFM-69, XFM-70).

import { getSchemaVersion } from "../db/migrator.js";
import {
  getActiveWorkers,
  isWorkerReady,
} from "../diagnostics/worker-registry.js";
import { getDb, getJobRepository, getRunRepository } from "../runs.js";
import { jsonResponse } from "./responses.js";

/**
 * GET /api/health (Liveness Probe)
 * Fast in-process check verifying that the HTTP server is alive and responding.
 */
export function handleHealthRoute(): Response {
  return jsonResponse({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
}

export interface ReadinessCheckResult {
  status: "ready" | "unavailable";
  database: {
    status: "ready" | "unavailable";
    version?: number | undefined;
    journalMode?: string | undefined;
    error?: string | undefined;
  };
  worker: {
    status: "ready" | "unavailable";
    activeWorkers: number;
    reason?: string | undefined;
  };
  timestamp: string;
}

/**
 * GET /api/ready (Readiness Probe)
 * Deep health check verifying that SQLite and background workers are available to accept work.
 */
export function handleReadyRoute(): Response {
  let dbReady = false;
  let schemaVersion = 0;
  let journalMode = "unknown";
  let dbError: string | undefined;

  try {
    const db = getDb();
    const ping = db.query("SELECT 1 as alive;").get() as {
      alive: number;
    } | null;
    if (ping?.alive === 1) {
      dbReady = true;
    }

    schemaVersion = getSchemaVersion(db);
    const jm = db.query("PRAGMA journal_mode;").get() as {
      journal_mode: string;
    } | null;
    journalMode = jm?.journal_mode || "unknown";
  } catch (err: unknown) {
    dbReady = false;
    dbError = err instanceof Error ? err.message : String(err);
  }

  const activeWorkers = getActiveWorkers();
  const workerReady = activeWorkers.length > 0;

  const isReady = dbReady && schemaVersion >= 6 && workerReady;
  const statusCode = isReady ? 200 : 503;

  const result: ReadinessCheckResult = {
    status: isReady ? "ready" : "unavailable",
    database: {
      status: dbReady ? "ready" : "unavailable",
      version: schemaVersion,
      journalMode,
      ...(dbError ? { error: dbError } : {}),
    },
    worker: {
      status: workerReady ? "ready" : "unavailable",
      activeWorkers: activeWorkers.length,
      ...(!workerReady
        ? { reason: "No active background worker heartbeats detected" }
        : {}),
    },
    timestamp: new Date().toISOString(),
  };

  return jsonResponse(result, statusCode);
}

/**
 * GET /api/diagnostics
 * Detailed operational telemetry covering database counts, active/stale jobs, and worker fleet.
 */
export function handleDiagnosticsRoute(): Response {
  const db = getDb();
  const jobRepo = getJobRepository();
  const runRepo = getRunRepository();

  const runs = runRepo.list();
  const activeRuns = runs.filter(
    (r) => !["pr_created", "stopped", "failed"].includes(r.status),
  );

  const staleJobs = jobRepo.findStaleClaimedJobs();
  const activeWorkers = getActiveWorkers();

  // Query job counts by status directly from SQLite
  const jobCountsRow = db
    .query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM jobs;`,
    )
    .get() as {
    total: number;
    pending: number | null;
    claimed: number | null;
    completed: number | null;
    failed: number | null;
  } | null;

  return jsonResponse({
    status: "ok",
    system: {
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: process.memoryUsage(),
    },
    database: {
      status: "healthy",
      version: getSchemaVersion(db),
      runs: {
        total: runs.length,
        active: activeRuns.length,
      },
      jobs: {
        total: jobCountsRow?.total ?? 0,
        pending: jobCountsRow?.pending ?? 0,
        claimed: jobCountsRow?.claimed ?? 0,
        completed: jobCountsRow?.completed ?? 0,
        failed: jobCountsRow?.failed ?? 0,
        stale: staleJobs.length,
      },
    },
    worker: {
      status: isWorkerReady() ? "healthy" : "unavailable",
      activeCount: activeWorkers.length,
      fleet: activeWorkers,
    },
    timestamp: new Date().toISOString(),
  });
}
