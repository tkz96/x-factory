// src/diagnostics/worker-registry.ts — SQLite-backed registry for active worker heartbeats (XFM-69, XFM-70).

import type { Database } from "bun:sqlite";
import os from "node:os";
import { WorkerHeartbeatRepository } from "../db/worker-heartbeat-repository.js";
import { getDb } from "../runs.js";

// Repositories are keyed by the handle they were built on, so a reopened
// database gets a fresh repository instead of a stale, closed one.
const heartbeatRepoCache = new WeakMap<Database, WorkerHeartbeatRepository>();
let heartbeatRepoOverride: WorkerHeartbeatRepository | null = null;

function getHeartbeatRepo(): WorkerHeartbeatRepository {
  if (heartbeatRepoOverride) return heartbeatRepoOverride;
  const db = getDb();
  let repo = heartbeatRepoCache.get(db);
  if (!repo) {
    repo = new WorkerHeartbeatRepository(db);
    heartbeatRepoCache.set(db, repo);
  }
  return repo;
}

export function setHeartbeatRepoForTesting(
  repo: WorkerHeartbeatRepository | null,
): void {
  heartbeatRepoOverride = repo;
}

/**
 * Registers or updates a worker's heartbeat timestamp in SQLite.
 */
export function registerWorkerHeartbeat(
  workerId: string,
  metadata?: { hostname?: string | undefined; pid?: number | undefined },
): void {
  const pid = metadata?.pid ?? process.pid;
  const hostname = metadata?.hostname ?? os.hostname();
  try {
    getHeartbeatRepo().upsert(workerId, pid, hostname);
  } catch {
    // Ignore if table does not exist yet (e.g. unmigrated database)
  }
}

/**
 * Removes a worker from the active registry on shutdown.
 */
export function unregisterWorker(workerId: string): void {
  try {
    getHeartbeatRepo().remove(workerId);
  } catch {
    // Ignore if table does not exist
  }
}

/**
 * Returns a list of all currently active workers whose heartbeat is within ttlMs.
 */
export function getActiveWorkers(
  ttlMs = 30000,
): Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }> {
  try {
    const now = Date.now();
    const records = getHeartbeatRepo().getActiveWorkers(ttlMs);
    return records.map((r) => {
      const ageMs = Math.max(0, now - new Date(r.lastHeartbeat).getTime());
      return {
        workerId: r.workerId,
        lastHeartbeatAt: r.lastHeartbeat,
        ageMs,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Evaluates whether at least one worker is active and healthy via SQLite.
 */
export function isWorkerReady(ttlMs = 30000): boolean {
  return getHeartbeatRepo().isReady(ttlMs);
}

/**
 * Clears the registry for test isolation.
 */
export function resetWorkerRegistryForTesting(): void {
  heartbeatRepoOverride = null;
  try {
    getDb().prepare("DELETE FROM worker_heartbeats;").run();
  } catch {
    // ignore if table doesn't exist yet in mock tests
  }
}
