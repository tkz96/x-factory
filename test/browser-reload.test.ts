// test/browser-reload.test.ts — Browser reload and direct deep-linking restoration for /runs/:runId (XFM-59).

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  QUERY_POLICIES,
  queryKeys,
} from "../src/frontend/lib/query-policies.js";
import { handleApi } from "../src/http/routes.js";
import { serveStatic } from "../src/http/static.js";
import { setDbForTesting } from "../src/runs.js";
import { getPublicDir } from "../src/server.js";
import type { Run } from "../src/shared/types.js";

describe("Browser Reload Restoration for /runs/:runId (XFM-59)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    const runId = `run-reload-${Date.now()}`;
    runRepo.create({
      id: runId,
      projectId: "proj-reload",
      projectName: "Reload Project",
      ticket: {
        id: "REL-101",
        title: "Direct Deep Link Ticket",
        acceptanceCriteria: ["AC 1", "AC 2"],
      },
      plan: "Plan for reload",
      branch: "factory/rel-101",
      status: "verifying",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    runRepo.update(runId, {
      diff: "diff --git a/file.ts b/file.ts\n+added code",
      verification: {
        passed: true,
        repairAttempt: 0,
        tests: {
          command: "bun test",
          exitCode: 0,
          stdout: "1 passed",
          stderr: "",
          passed: true,
          durationMs: 42,
        },
        diff: "+added code",
        filesChanged: ["file.ts"],
        hasPollution: false,
        summary: "Verification passed",
      },
    });

    // Record stage attempts
    const a1 = stageAttemptRepo.recordStart(runId, "prepare", 1);
    stageAttemptRepo.recordCompletion(a1.id, { ok: true });
    const a2 = stageAttemptRepo.recordStart(runId, "understand", 1);
    stageAttemptRepo.recordCompletion(a2.id, { ok: true });
    const a3 = stageAttemptRepo.recordStart(runId, "implement", 1);
    stageAttemptRepo.recordCompletion(a3.id, { ok: true });
    stageAttemptRepo.recordStart(runId, "verify", 1);

    // Record events in SQLite event_store
    eventRepo.appendEvent(runId, "status", { status: "preparing" });
    eventRepo.appendEvent(runId, "status", { status: "understanding" });
    eventRepo.appendEvent(runId, "status", { status: "implementing" });
    eventRepo.appendEvent(runId, "status", { status: "verifying" });

    return { db, runRepo, eventRepo, stageAttemptRepo, runId };
  }

  it("serves SPA index.html fallback for direct GET /runs/:runId browser reload", async () => {
    const { runId } = setupTest();
    const publicDir = getPublicDir();

    // 1. Browser reload on canonical deep link /runs/:runId
    const res = await serveStatic(`/runs/${runId}`, publicDir);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    // Verify SPA root element is present so shell mounts
    const hasRoot =
      html.includes('id="root"') || html.includes('id="app-shell"');
    expect(hasRoot).toBe(true);
    expect(html).toContain("<title>X-Factory</title>");
  });

  it("restores complete run detail, verification, and diff directly without prior /runs list visit", async () => {
    const { runId } = setupTest();

    // 2. React frontend makes direct API query for the run on mount
    const req = new Request(`http://localhost/api/runs/${runId}`);
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const runData = (await res.json()) as Run;
    expect(runData.id).toBe(runId);
    expect(runData.status).toBe("verifying");
    expect(runData.ticket.id).toBe("REL-101");
    expect(runData.ticket.title).toBe("Direct Deep Link Ticket");
    expect(runData.ticket.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
    expect(runData.diff).toContain("+added code");
    expect(runData.verification).toBeDefined();
    expect(runData.verification?.passed).toBe(true);

    // 3. TanStack Query queryClient stores run directly
    const queryClient = new QueryClient();
    const runKey = queryKeys.run(runId);
    const cachedRun = await queryClient.fetchQuery({
      queryKey: runKey,
      queryFn: async () => runData,
      staleTime: QUERY_POLICIES.run.staleTime,
    });
    expect(cachedRun.id).toBe(runId);

    // Runs list is not yet loaded in cache (cold start on deep link)
    expect(queryClient.getQueryData(queryKeys.runs())).toBeUndefined();
  });

  it("restores complete event stream from SQLite on direct SSE connection after reload", async () => {
    const { runId } = setupTest();

    const req = new Request(`http://localhost/api/runs/${runId}/events`);
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("reader missing");

    // Read all 4 historical events
    const events: string[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = await reader.read();
      if (chunk.value) {
        events.push(new TextDecoder().decode(chunk.value));
      }
    }

    expect(events.length).toBe(4);
    expect(events[0] ?? "").toContain("preparing");
    expect(events[1] ?? "").toContain("understanding");
    expect(events[2] ?? "").toContain("implementing");
    expect(events[3] ?? "").toContain("verifying");

    await reader?.cancel();
  });
});
