// src/db/event-repository.ts — Durable SQLite repository for run lifecycle events (XFM-12, XFM-13).

import type { Database } from "bun:sqlite";
import type { RunEventPayloadMap, RunEventType } from "../shared/types.js";
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
    payload: parseJsonColumn<unknown>(
      row.payload,
      row.payload,
    ) as RunEventPayloadMap[RunEventType],
    createdAt: row.created_at,
  } as EventRecord;
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
    const conn = this.db;
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

    const stmt = conn.prepare<
      EventRow,
      {
        $runId: string;
        $type: string;
        $payload: string;
        $createdAt: string;
      }
    >(query);

    const row = stmt.get({
      $runId: runId,
      $type: type,
      $payload: serializedPayload,
      $createdAt: now,
    });

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
    const conn = this.db;
    const sinceSequence = options?.sinceSequence ?? null;

    let query: string;
    let rows: EventRow[];

    if (sinceSequence !== null && sinceSequence !== undefined) {
      query = `
        SELECT * FROM run_events
        WHERE run_id = $runId AND sequence > $sinceSequence
        ORDER BY sequence ASC;
      `;
      const stmt = conn.prepare<
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
      const stmt = conn.prepare<EventRow, { $runId: string }>(query);
      rows = stmt.all({ $runId: runId });
    }

    return rows.map(rowToEventRecord);
  }

  /**
   * Gets the highest sequence number recorded for a run (or 0 if none exist).
   */
  getLatestSequence(runId: string): number {
    const conn = this.db;
    const stmt = conn.prepare<{ max_seq: number | null }, { $runId: string }>(
      "SELECT MAX(sequence) as max_seq FROM run_events WHERE run_id = $runId;",
    );
    const result = stmt.get({ $runId: runId });
    return result?.max_seq ?? 0;
  }
}
