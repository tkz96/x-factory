// src/diagnostics/worker-registry.ts — SQLite-backed registry for active worker heartbeats (XFM-69, XFM-70).
//
// The heartbeat repository is passed in by the caller, who holds the process's
// one connection (composition root, #169). Nothing here pins a connection.

import os from "node:os";
import type { WorkerHeartbeatRepository } from "../db/worker-heartbeat-repository.js";

/**
 * Registers or updates a worker's heartbeat timestamp in SQLite.
 */
export function registerWorkerHeartbeat(
  heartbeats: WorkerHeartbeatRepository,
  workerId: string,
  metadata?: { hostname?: string | undefined; pid?: number | undefined },
): void {
  const pid = metadata?.pid ?? process.pid;
  const hostname = metadata?.hostname ?? os.hostname();
  try {
    heartbeats.upsert(workerId, pid, hostname);
  } catch {
    // Ignore if table does not exist yet (e.g. unmigrated database)
  }
}

/**
 * Removes a worker from the active registry on shutdown.
 */
export function unregisterWorker(
  heartbeats: WorkerHeartbeatRepository,
  workerId: string,
): void {
  try {
    heartbeats.remove(workerId);
  } catch {
    // Ignore if table does not exist
  }
}

/**
 * Returns a list of all currently active workers whose heartbeat is within ttlMs.
 */
export function getActiveWorkers(
  heartbeats: WorkerHeartbeatRepository,
  ttlMs: number,
): Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }> {
  try {
    const now = Date.now();
    const records = heartbeats.getActiveWorkers(ttlMs);
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
export function isWorkerReady(
  heartbeats: WorkerHeartbeatRepository,
  ttlMs: number,
): boolean {
  return heartbeats.isReady(ttlMs);
}
