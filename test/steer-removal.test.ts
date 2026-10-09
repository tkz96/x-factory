// test/steer-removal.test.ts — Steering is removed, not ported (#167).
//
// Existing databases can still hold `steer` rows in run_commands and `steer`
// events in run_events. These tests pin the behaviour after removal, at three
// seams:
//   1. HTTP API seam — POST /api/runs/:id/steer returns 404 through handleApi.
//   2. Worker seam — a leftover steer command row is failed cleanly, never
//      crash-looped or silently retried.
//   3. Client run-state seam — a leftover steer event renders as a neutral
//      fallback in ChatThread / EventLogViewer instead of crashing.

import { afterAll, describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { EventLogViewer } from "../src/frontend/components/runs/EventLogViewer.js";
import { handleApi } from "../src/http/routes.js";
import type { RunEvent } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import { insertLegacySteerCommand } from "./helpers/legacy-steer-command.js";

let repos: Repositories;

function setupTest() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  repos = createRepositories(db);
  const runRepo = new RunRepository(db);
  const eventRepo = new EventRepository(db);
  return { db, runRepo, eventRepo };
}

function createRun(runRepo: RunRepository, runId: string) {
  return runRepo.create({
    id: runId,
    projectId: "proj-steer-removal",
    projectName: "Steer Removal Project",
    ticket: {
      id: "SR-1",
      title: "Steer Removal",
      acceptanceCriteria: [],
    },
    plan: "Plan",
    branch: "factory/steer-removal",
    status: "executing",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });
}

afterAll(() => {});

describe("Steering removed (#167)", () => {
  it("POST /api/runs/:id/steer returns 404 through handleApi", async () => {
    const { runRepo } = setupTest();
    const runId = "run-steer-removed-404";
    createRun(runRepo, runId);

    const req = new Request(`http://localhost:3777/api/runs/${runId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Focus on auth.ts" }),
    });
    const res = await handleApi(req, new URL(req.url), { repos });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Endpoint not found." });
  });

  it("fails a leftover steer command row instead of crashing on it", async () => {
    const { db, runRepo } = setupTest();
    const runId = "run-steer-leftover-cmd";
    createRun(runRepo, runId);

    // Simulate a database written by a version that still had steering: the
    // repository no longer accepts "steer" as a CommandType, so insert the
    // legacy row exactly as it exists on disk.
    const commandId = "cmd-leftover-steer";
    insertLegacySteerCommand(db, {
      id: commandId,
      runId,
      message: "legacy steer",
    });

    const commandRepo = new CommandRepository(db);
    const worker = new Worker({ db, workerId: "worker-steer-leftover" });
    const claimed = commandRepo.claimPendingCommands(
      "worker-steer-leftover",
      30000,
    );
    const leftover = claimed.find((c) => c.id === commandId);
    expect(leftover).toBeDefined();
    if (leftover) await worker.processCommand(leftover);

    const updated = commandRepo.getCommand(commandId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe('Unsupported command type "steer"');
  });

  // Lease-expiry reclaim (#167): the reclaim query no longer excludes steer,
  // so a leftover CLAIMED steer row with an expired lease is handed back to
  // the pool, failed by the worker with "Unsupported command type", and never
  // retried forever.
  it("reclaims an expired claimed steer row, fails it once, and never retries it", async () => {
    const { db, runRepo } = setupTest();
    const runId = "run-steer-expired-claim";
    createRun(runRepo, runId);

    const commandId = "cmd-steer-expired-claim";
    const expiredLease = new Date(Date.now() - 60000).toISOString();
    insertLegacySteerCommand(db, {
      id: commandId,
      runId,
      message: "expired lease steer",
      status: "claimed",
      workerId: "crashed-worker",
      leaseUntil: expiredLease,
      attempts: 1,
      maxAttempts: 3,
    });

    const commandRepo = new CommandRepository(db);
    const worker = new Worker({ db, workerId: "worker-live" });

    // Step 1: the expired lease hands the row back to the pool.
    const reclaimed = commandRepo.claimPendingCommands("worker-live", 30000);
    const row = reclaimed.find((c) => c.id === commandId);
    expect(row).toBeDefined();
    expect(row?.status).toBe("claimed");
    expect(row?.workerId).toBe("worker-live");
    expect(row?.attempts).toBe(2);

    // Step 2: the worker fails it as an unsupported command type.
    if (row) await worker.processCommand(row);
    const updated = commandRepo.getCommand(commandId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe('Unsupported command type "steer"');

    // Step 3: terminal — never reclaimed again, attempts stay bounded.
    const again = commandRepo.claimPendingCommands("worker-live", 30000);
    expect(again.find((c) => c.id === commandId)).toBeUndefined();
    expect(commandRepo.getCommand(commandId)?.attempts).toBe(2);
  });

  it("renders a leftover steer event as a neutral fallback", () => {
    const { db, runRepo, eventRepo } = setupTest();
    const runId = "run-steer-leftover-event";
    createRun(runRepo, runId);

    // Simulate an old database row: the event type is gone from the union,
    // so write it straight into run_events and read it back.
    const message = "legacy steer note";
    db.run(
      `INSERT INTO run_events (run_id, sequence, type, payload, created_at)
       VALUES (?, 1, 'steer', ?, ?);`,
      [runId, JSON.stringify({ message }), new Date().toISOString()],
    );

    const wireEvents = eventRepo.getEventsForRun(runId).map((e) => ({
      id: e.sequence,
      timestamp: e.createdAt,
      type: e.type,
      payload: e.payload,
    })) as unknown as RunEvent[];

    const chatHtml = renderToString(
      React.createElement(ChatThread, { events: wireEvents }),
    );
    expect(chatHtml).not.toContain("bubble-steer");
    expect(chatHtml).not.toContain("Steer Action");
    expect(chatHtml).toContain(message);

    const logHtml = renderToString(
      React.createElement(EventLogViewer, { events: wireEvents }),
    );
    expect(logHtml).not.toContain("Steer:");
    expect(logHtml).toContain(message);
  });
});
