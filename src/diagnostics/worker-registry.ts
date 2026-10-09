// src/diagnostics/worker-registry.ts — SQLite-backed registry for active worker heartbeats (XFM-69, XFM-70).
//
// The heartbeat repository is passed in by the caller, who holds the process's
// one connection (composition root, #169). Nothing here pins a connection.

import os from "node:os";
import type { WorkerHeartbeatRepository } from "../db/worker-heartbeat-repository.js";
import type { LeaseManager } from "../lease.js";

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
 * Returns a list of all currently active workers, by the lease module's policy and clock.
 */
export function getActiveWorkers(
  lease: LeaseManager,
): Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }> {
  try {
    const now = lease.nowMs();
    return lease.activeWorkers().map((r) => ({
      workerId: r.workerId,
      lastHeartbeatAt: r.lastHeartbeat,
      ageMs: Math.max(0, now - new Date(r.lastHeartbeat).getTime()),
    }));
  } catch {
    return [];
  }
}

/**
 * Evaluates whether at least one worker is active and healthy via SQLite.
 */
export function isWorkerReady(lease: LeaseManager): boolean {
  return lease.isReady();
}
