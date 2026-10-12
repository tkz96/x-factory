// src/db/event-repository.ts — Durable SQLite repository for run lifecycle events (XFM-12, XFM-13).

import type { Database } from "bun:sqlite";
import {
  NEEDS_YOU_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../shared/run-status-policy.js";
import type {
  AppEventEnvelope,
  PrClosedPayload,
  PrMergedPayload,
  PullRequestOutcome,
  RunEventPayloadMap,
  RunEventType,
} from "../shared/types.js";
import { parseJsonColumn, serializeJsonColumn } from "./row-codec.js";

export type EventRecord<T extends RunEventType = RunEventType> =
  T extends RunEventType
    ? {
        id: number;
        runId: string;
        sequence: number;
        type: T;
        payload: RunEventPayloadMap[T];
        createdAt: string;
      }
    : never;

export interface EventRow {
  id: number;
  run_id: string;
  sequence: number;
  type: string;
  payload: string;
  created_at: string;
}

export function rowToEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type as RunEventType,
    // A malformed payload degrades to its raw text; only this field is lost.
    // Free-form diagnostic payloads keep the corrupt text so operators can
    // see what was stored (the rationale lives in src/db/row-codec.ts).
    payload: parseJsonColumn<unknown>(row.payload, row.payload, {
      table: "run_events",
      column: "payload",
      rowId: String(row.id),
    }) as RunEventPayloadMap[RunEventType],
    createdAt: row.created_at,
  } as EventRecord;
}

/** The notification-relevant event types the app-wide stream carries. */
const APP_EVENT_TYPES = [
  "status",
  "pr_step",
  "pr_merged",
  "pr_closed",
] as const;

/**
 * The 12 columns of an event joined to its run, shared by every app-wide read
 * so the three queries and `joinedRowToEnvelope` cannot drift apart.
 */
const JOINED_EVENT_SELECT = `SELECT
        e.id,
        e.run_id,
        e.sequence,
        e.type,
        e.payload,
        e.created_at,
        r.project_id,
        r.project_name,
        r.ticket_id,
        r.ticket_title,
        r.ticket_description,
        r.ticket_acceptance_criteria
      FROM run_events e
      JOIN runs r ON e.run_id = r.id`;

/** Placeholder names (`$status0`, `$status1`, …) for an IN list. */
function placeholders(values: Iterable<string>, prefix: string): string[] {
  return Array.from(values, (_, index) => `$${prefix}${index}`);
}

/** The parameter bindings that match `placeholders` for the same list. */
function bindList(
  values: Iterable<string>,
  prefix: string,
): Record<string, string> {
  const bound: Record<string, string> = {};
  Array.from(values).forEach((value, index) => {
    bound[`$${prefix}${index}`] = value;
  });
  return bound;
}

export class EventRepository {
  constructor(private db: Database) {}

  /**
   * Appends an event to the durable store with atomic monotonic sequence allocation (XFM-13).
   * Safe within external or internal transactions.
   */
  appendEvent<T extends RunEventType>(
    runId: string,
    type: T,
    payload: RunEventPayloadMap[T],
  ): EventRecord<T> {
    if (type === "pr_merged" || type === "pr_closed") {
      const existing = this.db
        .prepare<EventRow, { $runId: string }>(
          "SELECT * FROM run_events WHERE run_id = $runId AND type IN ('pr_merged', 'pr_closed') LIMIT 1;",
        )
        .get({ $runId: runId });
      if (existing) {
        return rowToEventRecord(existing) as EventRecord<T>;
      }
    }

    const now = new Date().toISOString();
    const serializedPayload = serializeJsonColumn(payload ?? {}) ?? "{}";

    const query = `
      INSERT INTO run_events (run_id, sequence, type, payload, created_at)
      VALUES (
        $runId,
        COALESCE((SELECT MAX(sequence) FROM run_events WHERE run_id = $runId), 0) + 1,
        $type,
        $payload,
        $createdAt
      )
      RETURNING *;
    `;

    const stmt = this.db.prepare<
      EventRow,
      {
        $runId: string;
        $type: string;
        $payload: string;
        $createdAt: string;
      }
    >(query);

    let row: EventRow | null = null;
    try {
      row = stmt.get({
        $runId: runId,
        $type: type,
        $payload: serializedPayload,
        $createdAt: now,
      });
    } catch (err: unknown) {
      if (
        (type === "pr_merged" || type === "pr_closed") &&
        err instanceof Error &&
        (err.message.includes("idx_run_events_pr_outcome") ||
          err.message.includes("UNIQUE constraint failed"))
      ) {
        const existing = this.db
          .prepare<EventRow, { $runId: string }>(
            "SELECT * FROM run_events WHERE run_id = $runId AND type IN ('pr_merged', 'pr_closed') LIMIT 1;",
          )
          .get({ $runId: runId });
        if (existing) {
          return rowToEventRecord(existing) as EventRecord<T>;
        }
      }
      throw err;
    }

    if (!row) {
      throw new Error(`Failed to append event for run ${runId}`);
    }

    return rowToEventRecord(row) as EventRecord<T>;
  }

  /**
   * Retrieves durable events for a run, optionally filtering by sinceSequence for replay (XFM-15).
   */
  getEventsForRun(
    runId: string,
    options?: { sinceSequence?: number | undefined },
  ): EventRecord[] {
    const sinceSequence = options?.sinceSequence ?? null;

    let query: string;
    let rows: EventRow[];

    if (sinceSequence !== null && sinceSequence !== undefined) {
      query = `
        SELECT * FROM run_events
        WHERE run_id = $runId AND sequence > $sinceSequence
        ORDER BY sequence ASC;
      `;
      const stmt = this.db.prepare<
        EventRow,
        {
          $runId: string;
          $sinceSequence: number;
        }
      >(query);
      rows = stmt.all({ $runId: runId, $sinceSequence: sinceSequence });
    } else {
      query = `
        SELECT * FROM run_events
        WHERE run_id = $runId
        ORDER BY sequence ASC;
      `;
      const stmt = this.db.prepare<EventRow, { $runId: string }>(query);
      rows = stmt.all({ $runId: runId });
    }

    return rows.map(rowToEventRecord);
  }

  /**
   * Gets the highest sequence number recorded for a run (or 0 if none exist).
   */
  getLatestSequence(runId: string): number {
    const stmt = this.db.prepare<
      { max_seq: number | null },
      { $runId: string }
    >("SELECT MAX(sequence) as max_seq FROM run_events WHERE run_id = $runId;");
    const result = stmt.get({ $runId: runId });
    return result?.max_seq ?? 0;
  }

  /**
   * Gets the highest global event ID recorded in run_events (or 0 if none exist).
   */
  getHighestEventId(): number {
    const stmt = this.db.prepare<{ max_id: number | null }, []>(
      "SELECT MAX(id) as max_id FROM run_events;",
    );
    const result = stmt.get();
    return result?.max_id ?? 0;
  }

  /**
   * Retrieves notification-relevant events across all runs with global id strictly greater
   * than sinceId (#257). Selects status and pr_step types from existing payload map.
   */
  getAppEventsSince(sinceId: number, limit?: number): AppEventEnvelope[] {
    const limitClause = typeof limit === "number" ? "LIMIT $limit" : "";
    const query = `
      ${JOINED_EVENT_SELECT}
      WHERE e.id > $sinceId AND e.type IN (${placeholders(APP_EVENT_TYPES, "type").join(", ")})
      ORDER BY e.id ASC
      ${limitClause};
    `;
    const params: Record<string, string | number> = {
      $sinceId: sinceId,
      ...bindList(APP_EVENT_TYPES, "type"),
    };
    if (typeof limit === "number") params.$limit = limit;
    const rows = this.db
      .prepare<JoinedEventRow, typeof params>(query)
      .all(params);
    return rows.map(joinedRowToEnvelope);
  }

  /**
   * Retrieves Needs-you triggering status events for runs currently in a Needs-you status
   * with id at or below cursor, with no age limit (#257).
   */
  getNeedsYouTriggerEvents(cursor: number): AppEventEnvelope[] {
    const query = `
      ${JOINED_EVENT_SELECT}
      WHERE r.status IN (${placeholders(NEEDS_YOU_RUN_STATUSES, "status").join(", ")})
        AND e.type = 'status'
        AND e.id <= $cursor
        AND e.id = (
          SELECT MAX(sub.id)
          FROM run_events sub
          WHERE sub.run_id = e.run_id AND sub.type = 'status' AND sub.id <= $cursor
        )
      ORDER BY e.id ASC;
    `;
    const params: Record<string, string | number> = {
      $cursor: cursor,
      ...bindList(NEEDS_YOU_RUN_STATUSES, "status"),
    };
    const rows = this.db
      .prepare<JoinedEventRow, typeof params>(query)
      .all(params);
    return rows.map(joinedRowToEnvelope);
  }

  /**
   * Retrieves Finished history events (the policy's terminal statuses plus pr_merged) at or below cursor,
   * bounded by 7 days and capped at limit (default 100), returned in ascending id order (#257, #271).
   */
  getFinishedHistoryEvents(
    cursor: number,
    sevenDaysAgo: string,
    limit = 100,
  ): AppEventEnvelope[] {
    const query = `
      ${JOINED_EVENT_SELECT}
      WHERE e.id <= $cursor
        AND (
          (e.type = 'status'
           AND json_extract(e.payload, '$.status') IN (${placeholders(TERMINAL_RUN_STATUSES, "status").join(", ")}))
          OR e.type = 'pr_merged'
        )
        AND e.created_at >= $sevenDaysAgo
      ORDER BY e.id DESC
      LIMIT $limit;
    `;
    const params: Record<string, string | number> = {
      $cursor: cursor,
      $sevenDaysAgo: sevenDaysAgo,
      $limit: limit,
      ...bindList(TERMINAL_RUN_STATUSES, "status"),
    };
    const rows = this.db
      .prepare<JoinedEventRow, typeof params>(query)
      .all(params);
    return rows.reverse().map(joinedRowToEnvelope);
  }

  /**
   * Returns the PR outcome (merged or closed) for a run, or null if not yet detected.
   */
  getPullRequestOutcome(runId: string): PullRequestOutcome | null {
    const row = this.db
      .prepare<EventRow, { $runId: string }>(
        "SELECT * FROM run_events WHERE run_id = $runId AND type IN ('pr_merged', 'pr_closed') LIMIT 1;",
      )
      .get({ $runId: runId });
    if (!row) return null;
    const rec = rowToEventRecord(row);
    if (rec.type === "pr_merged") {
      const p = rec.payload as PrMergedPayload;
      return {
        status: "merged",
        state: "merged",
        url: p.url,
        mergedAt: p.mergedAt,
        mergedBy: p.mergedBy,
      };
    }
    if (rec.type === "pr_closed") {
      const p = rec.payload as PrClosedPayload;
      return {
        status: "closed",
        state: "closed",
        url: p.url,
        closedAt: p.closedAt,
      };
    }
    return null;
  }

  /**
   * Returns a map of runId -> PullRequestOutcome for all runs with recorded PR outcomes.
   */
  listPullRequestOutcomes(): Map<string, PullRequestOutcome> {
    const rows = this.db
      .prepare<EventRow, []>(
        "SELECT * FROM run_events WHERE type IN ('pr_merged', 'pr_closed');",
      )
      .all();
    const map = new Map<string, PullRequestOutcome>();
    for (const row of rows) {
      const rec = rowToEventRecord(row);
      if (rec.type === "pr_merged") {
        const p = rec.payload as PrMergedPayload;
        map.set(rec.runId, {
          status: "merged",
          state: "merged",
          url: p.url,
          mergedAt: p.mergedAt,
          mergedBy: p.mergedBy,
        });
      } else if (rec.type === "pr_closed") {
        const p = rec.payload as PrClosedPayload;
        map.set(rec.runId, {
          status: "closed",
          state: "closed",
          url: p.url,
          closedAt: p.closedAt,
        });
      }
    }
    return map;
  }
}

export interface JoinedEventRow {
  id: number;
  run_id: string;
  sequence: number;
  type: string;
  payload: string;
  created_at: string;
  project_id: string;
  project_name: string;
  ticket_id: string;
  ticket_title: string;
  ticket_description: string | null;
  ticket_acceptance_criteria: string;
}

export function joinedRowToEnvelope(row: JoinedEventRow): AppEventEnvelope {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type as RunEventType,
    payload: parseJsonColumn<unknown>(row.payload, row.payload, {
      table: "run_events",
      column: "payload",
      rowId: String(row.id),
    }) as RunEventPayloadMap[RunEventType],
    time: row.created_at,
    ticket: {
      id: row.ticket_id,
      title: row.ticket_title,
      description: row.ticket_description || undefined,
      acceptanceCriteria: parseJsonColumn<string[]>(
        row.ticket_acceptance_criteria,
        [],
        {
          table: "runs",
          column: "ticket_acceptance_criteria",
          rowId: row.run_id,
        },
      ),
    },
    project: {
      id: row.project_id,
      name: row.project_name,
    },
  };
}
