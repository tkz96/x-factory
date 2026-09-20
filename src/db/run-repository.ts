// src/db/run-repository.ts — SQLite-backed authoritative repository for workflow runs.

import type { Database } from "bun:sqlite";
import { defaultEventBus } from "../events.js";
import type {
  ImplementationContext,
  PullRequest,
  ReviewResult,
  Run,
  RunStatus,
  Ticket,
  VerificationResult,
} from "../shared/types.js";
import { canTransition } from "../state-machine.js";

export class RunNotFoundError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`Run "${runId}" not found.`);
    this.name = "RunNotFoundError";
    this.runId = runId;
  }
}

export class StaleRevisionError extends Error {
  readonly runId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(runId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Conflict: Run "${runId}" revision ${actualRevision} does not match expected revision ${expectedRevision}.`,
    );
    this.name = "StaleRevisionError";
    this.runId = runId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class IllegalStateTransitionError extends Error {
  readonly fromState: RunStatus;
  readonly toState: RunStatus;
  constructor(fromState: RunStatus, toState: RunStatus) {
    super(`Illegal run state transition from '${fromState}' to '${toState}'.`);
    this.name = "IllegalStateTransitionError";
    this.fromState = fromState;
    this.toState = toState;
  }
}

export interface RunRecord extends Run {
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRunRecordInput {
  id: string;
  projectId: string;
  projectName: string;
  ticket: Ticket;
  plan: string;
  branch: string;
  status: RunStatus;
  startedAt?: string | undefined;
  artifactsDir: string;
  worktreePath: string;
  repairAttempts?: number | undefined;
}

export interface UpdateRunRecordInput {
  status?: RunStatus | undefined;
  finishedAt?: string | null | undefined;
  repairAttempts?: number | undefined;
  implementationContext?: ImplementationContext | null | undefined;
  verification?: VerificationResult | null | undefined;
  review?: ReviewResult | null | undefined;
  diff?: string | null | undefined;
  pullRequest?: PullRequest | null | undefined;
  expectedRevision?: number | undefined;
  worktreePath?: string | undefined;
}

interface RunRow {
  id: string;
  project_id: string;
  project_name: string;
  ticket_id: string;
  ticket_title: string;
  ticket_description: string | null;
  ticket_acceptance_criteria: string;
  plan: string;
  branch: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  repair_attempts: number;
  artifacts_dir: string;
  worktree_path: string;
  revision: number;
  implementation_context: string | null;
  verification: string | null;
  review: string | null;
  artifacts: string | null;
  diff: string | null;
  pull_request: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRunRecord(row: RunRow): RunRecord {
  let criteria: string[] = [];
  try {
    criteria = JSON.parse(row.ticket_acceptance_criteria) as string[];
  } catch {
    criteria = [];
  }

  const ticket: Ticket = {
    id: row.ticket_id,
    title: row.ticket_title,
    description: row.ticket_description || undefined,
    acceptanceCriteria: criteria,
  };

  return {
    id: row.id,
    project: {
      id: row.project_id,
      name: row.project_name,
    },
    ticket,
    plan: row.plan,
    branch: row.branch,
    status: row.status as RunStatus,
    events: [],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    repairAttempts: row.repair_attempts,
    artifactsDir: row.artifacts_dir,
    worktreePath: row.worktree_path,
    diff: row.diff,
    implementationContext: row.implementation_context
      ? (JSON.parse(row.implementation_context) as ImplementationContext)
      : null,
    verification: row.verification
      ? (JSON.parse(row.verification) as VerificationResult)
      : null,
    review: row.review ? (JSON.parse(row.review) as ReviewResult) : null,
    artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
    pullRequest: row.pull_request
      ? (JSON.parse(row.pull_request) as PullRequest)
      : null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RunRepository {
  constructor(private db: Database) {}

  create(input: CreateRunRecordInput): RunRecord {
    const now = new Date().toISOString();
    const startedAt = input.startedAt || now;

    const stmt = this.db.prepare(`
      INSERT INTO runs (
        id, project_id, project_name, ticket_id, ticket_title, ticket_description,
        ticket_acceptance_criteria, plan, branch, status, started_at, finished_at,
        repair_attempts, artifacts_dir, worktree_path, revision, implementation_context,
        verification, review, artifacts, diff, pull_request, created_at, updated_at
      ) VALUES (
        $id, $projectId, $projectName, $ticketId, $ticketTitle, $ticketDescription,
        $criteria, $plan, $branch, $status, $startedAt, NULL,
        $repairAttempts, $artifactsDir, $worktreePath, 1, NULL,
        NULL, NULL, '[]', NULL, NULL, $now, $now
      )
      RETURNING *;
    `);

    const row = stmt.get({
      $id: input.id,
      $projectId: input.projectId,
      $projectName: input.projectName,
      $ticketId: input.ticket.id,
      $ticketTitle: input.ticket.title,
      $ticketDescription: input.ticket.description ?? null,
      $criteria: JSON.stringify(input.ticket.acceptanceCriteria || []),
      $plan: input.plan,
      $branch: input.branch,
      $status: input.status,
      $startedAt: startedAt,
      $repairAttempts: input.repairAttempts ?? 0,
      $artifactsDir: input.artifactsDir,
      $worktreePath: input.worktreePath,
      $now: now,
    }) as RunRow;

    return rowToRunRecord(row);
  }

  get(id: string): RunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM runs WHERE id = ?;");
    const row = stmt.get(id) as RunRow | null;
    return row ? rowToRunRecord(row) : null;
  }

  list(): RunRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM runs ORDER BY created_at DESC;",
    );
    const rows = stmt.all() as RunRow[];
    return rows.map(rowToRunRecord);
  }

  /**
   * Retrieves all runs in an active, non-terminal state.
   */
  listActive(): RunRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM runs
      WHERE status NOT IN ('pr_created', 'failed', 'stopped', 'recovery_required')
      ORDER BY created_at ASC;
    `);
    const rows = stmt.all() as RunRow[];
    return rows.map(rowToRunRecord);
  }

  update(id: string, updates: UpdateRunRecordInput): RunRecord {
    const current = this.get(id);
    if (!current) {
      throw new RunNotFoundError(id);
    }

    if (
      updates.expectedRevision !== undefined &&
      current.revision !== updates.expectedRevision
    ) {
      throw new StaleRevisionError(
        id,
        updates.expectedRevision,
        current.revision,
      );
    }

    const now = new Date().toISOString();
    const newRevision = current.revision + 1;

    const fields: string[] = [
      "revision = $revision",
      "updated_at = $updatedAt",
    ];
    const params: Record<string, string | number | null> = {
      $id: id,
      $revision: newRevision,
      $updatedAt: now,
    };

    if (updates.status !== undefined) {
      fields.push("status = $status");
      params.$status = updates.status;
    }

    if (updates.finishedAt !== undefined) {
      fields.push("finished_at = $finishedAt");
      params.$finishedAt = updates.finishedAt;
    }

    if (updates.repairAttempts !== undefined) {
      fields.push("repair_attempts = $repairAttempts");
      params.$repairAttempts = updates.repairAttempts;
    }

    if (updates.implementationContext !== undefined) {
      fields.push("implementation_context = $implementationContext");
      params.$implementationContext = updates.implementationContext
        ? JSON.stringify(updates.implementationContext)
        : null;
    }

    if (updates.verification !== undefined) {
      fields.push("verification = $verification");
      params.$verification = updates.verification
        ? JSON.stringify(updates.verification)
        : null;
    }

    if (updates.review !== undefined) {
      fields.push("review = $review");
      params.$review = updates.review ? JSON.stringify(updates.review) : null;
    }

    if (updates.diff !== undefined) {
      fields.push("diff = $diff");
      params.$diff = updates.diff;
    }

    if (updates.pullRequest !== undefined) {
      fields.push("pull_request = $pullRequest");
      params.$pullRequest = updates.pullRequest
        ? JSON.stringify(updates.pullRequest)
        : null;
    }

    if (updates.worktreePath !== undefined) {
      fields.push("worktree_path = $worktreePath");
      params.$worktreePath = updates.worktreePath;
    }

    const sql = `
      UPDATE runs
      SET ${fields.join(", ")}
      WHERE id = $id
      RETURNING *;
    `;

    const row = this.db.prepare(sql).get(params) as RunRow;
    return rowToRunRecord(row);
  }

  /**
   * Atomic state transition with legal FSM enforcement, optimistic concurrency guard,
   * and transactional event persistence (XFM-08, XFM-09, XFM-14).
   */
  transitionRun(
    runId: string,
    fromState: RunStatus,
    toState: RunStatus,
    options?: {
      expectedRevision?: number | undefined;
      event?: { type: string; payload: unknown } | undefined;
      finishedAt?: string | null | undefined;
    },
  ): RunRecord {
    // 1. Verify transition legality against FSM (XFM-08)
    if (!canTransition(fromState, toState)) {
      throw new IllegalStateTransitionError(fromState, toState);
    }

    let eventToBroadcast: {
      runId: string;
      type: string;
      payload: unknown;
    } | null = null;

    // 2. Execute transition and durable event atomically
    const tx = this.db.transaction(() => {
      const selectStmt = this.db.prepare("SELECT * FROM runs WHERE id = ?;");
      const current = selectStmt.get(runId) as RunRow | null;
      if (!current) {
        throw new RunNotFoundError(runId);
      }

      if (current.status !== fromState) {
        throw new IllegalStateTransitionError(
          current.status as RunStatus,
          toState,
        );
      }

      if (
        options?.expectedRevision !== undefined &&
        current.revision !== options.expectedRevision
      ) {
        throw new StaleRevisionError(
          runId,
          options.expectedRevision,
          current.revision,
        );
      }

      const now = new Date().toISOString();
      const newRevision = current.revision + 1;
      const finishedAt =
        options?.finishedAt !== undefined
          ? options.finishedAt
          : toState === "pr_created" ||
              toState === "failed" ||
              toState === "stopped"
            ? now
            : current.finished_at;

      const updateStmt = this.db.prepare(`
        UPDATE runs
        SET status = $status,
            revision = $revision,
            finished_at = $finishedAt,
            updated_at = $now
        WHERE id = $id AND revision = $currentRevision
        RETURNING *;
      `);

      const updatedRow = updateStmt.get({
        $status: toState,
        $revision: newRevision,
        $finishedAt: finishedAt,
        $now: now,
        $id: runId,
        $currentRevision: current.revision,
      }) as RunRow | null;

      if (!updatedRow) {
        throw new StaleRevisionError(
          runId,
          current.revision,
          current.revision + 1,
        );
      }

      // 3. Atomically insert event into run_events table if specified (XFM-14)
      if (options?.event) {
        const insertEventStmt = this.db.prepare(`
          INSERT INTO run_events (run_id, sequence, type, payload, created_at)
          VALUES (
            $runId,
            COALESCE((SELECT MAX(sequence) FROM run_events WHERE run_id = $runId), 0) + 1,
            $type,
            $payload,
            $createdAt
          );
        `);

        insertEventStmt.run({
          $runId: runId,
          $type: options.event.type,
          $payload:
            typeof options.event.payload === "string"
              ? options.event.payload
              : JSON.stringify(options.event.payload ?? {}),
          $createdAt: now,
        });

        eventToBroadcast = {
          runId,
          type: options.event.type,
          payload: options.event.payload,
        };
      }

      return rowToRunRecord(updatedRow);
    });

    const updated = tx();

    // 4. Broadcast event to SSE subscribers strictly AFTER transaction commit
    if (eventToBroadcast) {
      const evt: { runId: string; type: string; payload: unknown } =
        eventToBroadcast;
      if (evt.type === "status") {
        const text =
          typeof evt.payload === "object" &&
          evt.payload !== null &&
          "text" in evt.payload &&
          typeof (evt.payload as { text: unknown }).text === "string"
            ? (evt.payload as { text: string }).text
            : `Run transitioned to ${toState}`;

        defaultEventBus.emit(evt.runId, {
          type: "status",
          status: toState,
          text,
        });
      } else {
        const text =
          typeof evt.payload === "string"
            ? evt.payload
            : JSON.stringify(evt.payload ?? {});

        defaultEventBus.emit(evt.runId, {
          type: "info",
          text,
        });
      }
    }

    return updated;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM runs WHERE id = ?;");
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
