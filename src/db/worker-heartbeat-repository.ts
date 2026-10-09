// src/db/worker-heartbeat-repository.ts — Durable worker heartbeats repository (XFM-38).

import type { Database } from "bun:sqlite";

export interface WorkerHeartbeatRecord {
  workerId: string;
  pid: number;
  hostname: string;
  lastHeartbeat: string;
  startedAt: string;
}

interface WorkerHeartbeatRow {
  worker_id: string;
  pid: number;
  hostname: string;
  last_heartbeat: string;
  started_at: string;
}

function rowToRecord(row: WorkerHeartbeatRow): WorkerHeartbeatRecord {
  return {
    workerId: row.worker_id,
    pid: row.pid,
    hostname: row.hostname,
    lastHeartbeat: row.last_heartbeat,
    startedAt: row.started_at,
  };
}

export class WorkerHeartbeatRepository {
  constructor(private db: Database) {}

  /**
   * Upserts a worker heartbeat, preserving started_at across renewals (XFM-38).
   */
  upsert(
    workerIdOrData:
      | string
      | {
          workerId: string;
          pid: number;
          hostname: string;
          lastHeartbeat?: string;
          startedAt?: string;
        },
    pid?: number,
    hostname?: string,
  ): WorkerHeartbeatRecord {
    let workerId: string;
    let workerPid: number;
    let host: string;
    let lastHeartbeat: string;
    let startedAt: string;

    if (typeof workerIdOrData === "object") {
      workerId = workerIdOrData.workerId;
      workerPid = workerIdOrData.pid;
      host = workerIdOrData.hostname;
      lastHeartbeat = workerIdOrData.lastHeartbeat || new Date().toISOString();
      startedAt = workerIdOrData.startedAt || new Date().toISOString();
    } else {
      workerId = workerIdOrData;
      workerPid = pid ?? 0;
      host = hostname || "";
      const now = new Date().toISOString();
      lastHeartbeat = now;
      startedAt = now;
    }

    const query = `
      INSERT INTO worker_heartbeats (worker_id, pid, hostname, last_heartbeat, started_at)
      VALUES ($workerId, $pid, $hostname, $lastHeartbeat, $startedAt)
      ON CONFLICT(worker_id) DO UPDATE SET
        pid = excluded.pid,
        hostname = excluded.hostname,
        last_heartbeat = excluded.last_heartbeat
      RETURNING *;
    `;

    const row = this.db
      .prepare<
        WorkerHeartbeatRow,
        {
          $workerId: string;
          $pid: number;
          $hostname: string;
          $lastHeartbeat: string;
          $startedAt: string;
        }
      >(query)
      .get({
        $workerId: workerId,
        $pid: workerPid,
        $hostname: host,
        $lastHeartbeat: lastHeartbeat,
        $startedAt: startedAt,
      });

    if (!row) {
      throw new Error(`Failed to upsert heartbeat for worker ${workerId}`);
    }

    return rowToRecord(row);
  }

  /**
   * Retrieves active workers that heartbeated within the specified TTL.
   */
  getActiveWorkers(ttlMs = 30000): WorkerHeartbeatRecord[] {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();

    const rows = this.db
      .prepare<WorkerHeartbeatRow, [string]>(
        "SELECT * FROM worker_heartbeats WHERE last_heartbeat > ? ORDER BY last_heartbeat DESC;",
      )
      .all(cutoff);

    return rows.map(rowToRecord);
  }

  /**
   * Determines if at least one worker has heartbeated within the TTL.
   */
  isReady(ttlMs = 30000): boolean {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();

    const row = this.db
      .prepare<{ cnt: number }, [string]>(
        "SELECT COUNT(*) as cnt FROM worker_heartbeats WHERE last_heartbeat > ?;",
      )
      .get(cutoff);

    return (row?.cnt ?? 0) > 0;
  }

  /**
   * Determines if a specific worker has heartbeated within the TTL.
   */
  isWorkerActive(workerId: string, ttlMs = 30000): boolean {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();

    const row = this.db
      .prepare<{ cnt: number }, [string, string]>(
        "SELECT COUNT(*) as cnt FROM worker_heartbeats WHERE worker_id = ? AND last_heartbeat > ?;",
      )
      .get(workerId, cutoff);

    return (row?.cnt ?? 0) > 0;
  }

  /**
   * Removes a worker heartbeat upon graceful shutdown.
   */
  remove(workerId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM worker_heartbeats WHERE worker_id = ?;")
      .run(workerId);
    return result.changes > 0;
  }
}
