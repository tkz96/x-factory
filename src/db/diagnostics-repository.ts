// src/db/diagnostics-repository.ts — Read-only queries behind the diagnostics and
// readiness endpoints (#188). Run status filters are bound parameters built from
// TERMINAL_RUN_STATUSES in the shared run-status policy, never status literals in SQL.

import type { Database } from "bun:sqlite";
import { TERMINAL_RUN_STATUSES } from "../shared/run-status-policy.js";
import type { JobStatus } from "./job-repository.js";
import { getSchemaVersion } from "./migrator.js";

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

  /** The latest schema version applied to this database, or 0 when uninitialized. */
  schemaVersion(): number {
    return getSchemaVersion(this.db);
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

  /** Job counts by status. Every status is a bound parameter typed as JobStatus. */
  countJobs(): JobCounts {
    const statuses: JobStatus[] = ["pending", "claimed", "completed", "failed"];
    const countFor = (status: JobStatus) =>
      `SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS ${status}`;
    const row = this.db
      .query(
        `SELECT
          COUNT(*) AS total,
          ${statuses.map(countFor).join(",\n          ")}
        FROM jobs;`,
      )
      .get(...statuses) as JobCountRow | null;
    return {
      total: row?.total ?? 0,
      pending: row?.pending ?? 0,
      claimed: row?.claimed ?? 0,
      completed: row?.completed ?? 0,
      failed: row?.failed ?? 0,
    };
  }
}
