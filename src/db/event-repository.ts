// src/db/event-repository.ts — Durable SQLite repository for run lifecycle events (XFM-12, XFM-13).

import type { Database } from "bun:sqlite";

export interface EventRecord {
  id: number;
  runId: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: string;
}

interface EventRow {
  id: number;
  run_id: string;
  sequence: number;
  type: string;
  payload: string;
  created_at: string;
}

function rowToEventRecord(row: EventRow): EventRecord {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch {
    parsedPayload = row.payload;
  }

  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type,
    payload: parsedPayload,
    createdAt: row.created_at,
  };
}

export class EventRepository {
  constructor(private db: Database) {}

  /**
   * Appends an event to the durable store with atomic monotonic sequence allocation (XFM-13).
   * Safe within external or internal transactions.
   */
  appendEvent(runId: string, type: string, payload: unknown): EventRecord {
    const now = new Date().toISOString();
    const serializedPayload =
      typeof payload === "string" ? payload : JSON.stringify(payload ?? {});

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

    const row = stmt.get({
      $runId: runId,
      $type: type,
      $payload: serializedPayload,
      $createdAt: now,
    });

    if (!row) {
      throw new Error(`Failed to append event for run ${runId}`);
    }

    return rowToEventRecord(row);
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
}
