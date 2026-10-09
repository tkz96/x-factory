// src/http/diagnostics-controller.ts — Endpoints for liveness, readiness, and runtime diagnostics (XFM-69, XFM-70).

import { getLatestMigrationVersion, getSchemaVersion } from "../db/migrator.js";
import {
  getActiveWorkers,
  isWorkerReady,
} from "../diagnostics/worker-registry.js";
import { getDb, getDiagnosticsRepository, getJobRepository } from "../runs.js";
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
  ready?: boolean | undefined;
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
  checks?:
    | Array<{
        name: string;
        status: "pass" | "warn" | "fail";
        message: string;
      }>
    | undefined;
  timestamp: string;
}

function computeReadinessStatus() {
  let dbReady = false;
  let schemaVersion = 0;
  let journalMode = "unknown";
  let dbError: string | undefined;

  try {
    const db = getDb();
    const diagnostics = getDiagnosticsRepository();
    dbReady = diagnostics.ping();
    schemaVersion = getSchemaVersion(db);
    journalMode = diagnostics.journalMode();
  } catch (err: unknown) {
    dbReady = false;
    dbError = err instanceof Error ? err.message : String(err);
  }

  const activeWorkers = getActiveWorkers();
  const workerReady = activeWorkers.length > 0;

  const isReady =
    dbReady && schemaVersion >= getLatestMigrationVersion() && workerReady;

  const result: ReadinessCheckResult = {
    ready: isReady,
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
    checks: [
      {
        name: "Database",
        status: dbReady ? "pass" : "fail",
        message: dbReady
          ? `SQLite version ${schemaVersion} (${journalMode})`
          : dbError || "Database connection unavailable",
      },
      {
        name: "Background Worker",
        status: workerReady ? "pass" : "warn",
        message: workerReady
          ? `${activeWorkers.length} active worker heartbeat(s)`
          : "No active background worker heartbeats detected",
      },
    ],
    timestamp: new Date().toISOString(),
  };

  return { isReady, result };
}

/**
 * GET /api/ready (Readiness Probe)
 * Deep health check verifying that SQLite and background workers are available to accept work.
 */
export function handleReadyRoute(): Response {
  const { isReady, result } = computeReadinessStatus();
  const statusCode = isReady ? 200 : 503;
  return jsonResponse(result, statusCode);
}

/**
 * GET /api/readiness (UI Readiness API)
 * Returns the full readiness assessment for the dashboard and UI banners.
 */
export function handleReadinessRoute(): Response {
  const { result } = computeReadinessStatus();
  return jsonResponse(result, 200);
}

/**
 * GET /api/diagnostics
 * Detailed operational telemetry covering database counts, active/stale jobs, and worker fleet.
 */
export function handleDiagnosticsRoute(): Response {
  const db = getDb();
  const diagnostics = getDiagnosticsRepository();
  const jobRepo = getJobRepository();

  const runCounts = diagnostics.countRuns();
  const jobCounts = diagnostics.countJobs();
  const staleJobs = jobRepo.findStaleClaimedJobs();
  const activeWorkers = getActiveWorkers();

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
        total: runCounts.total,
        active: runCounts.active,
      },
      jobs: {
        total: jobCounts.total,
        pending: jobCounts.pending,
        claimed: jobCounts.claimed,
        completed: jobCounts.completed,
        failed: jobCounts.failed,
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
