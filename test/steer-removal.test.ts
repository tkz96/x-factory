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
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { EventLogViewer } from "../src/frontend/components/runs/EventLogViewer.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";
import type { RunEvent } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";

function setupTest() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  setDbForTesting(db);
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

afterAll(() => {
  setDbForTesting(null);
});

describe("Steering removed (#167)", () => {
  it("POST /api/runs/:id/steer returns 404 through handleApi", async () => {
    const { runRepo } = setupTest();
    const runId = "run-steer-removed-404";
    createRun(runRepo, runId);

    const req = new Request(`http://localhost/api/runs/${runId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Focus on auth.ts" }),
    });
    const res = await handleApi(req, new URL(req.url));

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
    db.run(
      `INSERT INTO run_commands (id, run_id, command, payload, status, attempts, max_attempts, created_at)
       VALUES (?, ?, 'steer', ?, 'pending', 0, 3, ?);`,
      [
        commandId,
        runId,
        JSON.stringify({ message: "legacy steer" }),
        new Date().toISOString(),
      ],
    );

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
