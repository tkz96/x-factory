// src/diagnostics/worker-registry.ts — In-process and queryable registry for active worker heartbeats (XFM-69, XFM-70).

export interface WorkerHeartbeatRecord {
  workerId: string;
  lastHeartbeatAt: string;
  metadata?:
    | {
        hostname?: string | undefined;
        pid?: number | undefined;
      }
    | undefined;
}

const activeHeartbeats = new Map<string, WorkerHeartbeatRecord>();

/**
 * Registers or updates a worker's heartbeat timestamp.
 */
export function registerWorkerHeartbeat(
  workerId: string,
  metadata?: { hostname?: string | undefined; pid?: number | undefined },
): void {
  activeHeartbeats.set(workerId, {
    workerId,
    lastHeartbeatAt: new Date().toISOString(),
    metadata,
  });
}

/**
 * Removes a worker from the active registry on shutdown.
 */
export function unregisterWorker(workerId: string): void {
  activeHeartbeats.delete(workerId);
}

/**
 * Returns a list of all currently active workers whose heartbeat is within ttlMs.
 */
export function getActiveWorkers(
  ttlMs = 30000,
): Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }> {
  const now = Date.now();
  const result: Array<{
    workerId: string;
    lastHeartbeatAt: string;
    ageMs: number;
  }> = [];

  for (const [id, record] of activeHeartbeats.entries()) {
    const lastTime = new Date(record.lastHeartbeatAt).getTime();
    const ageMs = Math.max(0, now - lastTime);
    if (ageMs <= ttlMs) {
      result.push({
        workerId: id,
        lastHeartbeatAt: record.lastHeartbeatAt,
        ageMs,
      });
    }
  }

  return result;
}

/**
 * Evaluates whether at least one worker is active and healthy.
 */
export function isWorkerReady(ttlMs = 30000): boolean {
  return getActiveWorkers(ttlMs).length > 0;
}

/**
 * Clears the registry for test isolation.
 */
export function resetWorkerRegistryForTesting(): void {
  activeHeartbeats.clear();
}
