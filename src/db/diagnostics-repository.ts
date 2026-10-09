// src/db/diagnostics-repository.ts — Read-only queries behind the diagnostics and
// readiness endpoints (#188). Run status filters are bound parameters built from
// TERMINAL_RUN_STATUSES in the shared run-status policy, never status literals in SQL.

import type { Database } from "bun:sqlite";
import { TERMINAL_RUN_STATUSES } from "../shared/run-status-policy.js";

export interface RunCounts {
  total: number;
  active: number;
}

export interface JobCounts {
  total: number;
  pending: number;
  claimed: number;
  completed: number;
  failed: number;
}

interface RunCountRow {
  total: number;
  active: number | null;
}

interface JobCountRow {
  total: number;
  pending: number | null;
  claimed: number | null;
  completed: number | null;
  failed: number | null;
}

export class DiagnosticsRepository {
  constructor(private db: Database) {}

  /** Returns true when the database answers a trivial query. */
  ping(): boolean {
    const row = this.db.query("SELECT 1 AS alive;").get() as {
      alive: number;
    } | null;
    return row?.alive === 1;
  }

  /** The journal mode of the connection, or "unknown" when SQLite does not report one. */
  journalMode(): string {
    const row = this.db.query("PRAGMA journal_mode;").get() as {
      journal_mode: string;
    } | null;
    return row?.journal_mode || "unknown";
  }

  /** Total runs, and the runs that have not reached a terminal status. */
  countRuns(): RunCounts {
    const terminal = [...TERMINAL_RUN_STATUSES];
    const placeholders = terminal.map(() => "?").join(", ");
    const row = this.db
      .query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status NOT IN (${placeholders}) THEN 1 ELSE 0 END) AS active
        FROM runs;`,
      )
      .get(...terminal) as RunCountRow | null;
    return { total: row?.total ?? 0, active: row?.active ?? 0 };
  }

  /** Job counts by status. */
  countJobs(): JobCounts {
    const row = this.db
      .query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM jobs;`,
      )
      .get() as JobCountRow | null;
    return {
      total: row?.total ?? 0,
      pending: row?.pending ?? 0,
      claimed: row?.claimed ?? 0,
      completed: row?.completed ?? 0,
      failed: row?.failed ?? 0,
    };
  }
}
