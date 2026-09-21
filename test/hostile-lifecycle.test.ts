// test/hostile-lifecycle.test.ts — Hostile lifecycle scenarios: rapid switching, stream disruptions & subscriber isolation (XFM-66).

import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { patchRunCache } from "../src/frontend/lib/query-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { handleApi } from "../src/http/routes.js";
import { defaultSSERegistry } from "../src/http/sse-registry.js";
import { setDbForTesting } from "../src/runs.js";
import type { Run, RunStatus } from "../src/shared/types.js";

describe("Hostile Lifecycle UI & Stream Scenarios (XFM-66)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
    const runRepo = new RunRepository(db);
    const eventRepo = new EventRepository(db);

    return { db, runRepo, eventRepo };
  }

  function createTestRun(id: string, runRepo: RunRepository): Run {
    return runRepo.create({
      id,
      projectId: "proj-hostile",
      projectName: "Hostile Lifecycle Project",
      ticket: { id: `T-${id}`, title: `Ticket ${id}`, acceptanceCriteria: [] },
      plan: "Plan",
      branch: `factory/${id}`,
      status: "implementing",
      artifactsDir: `/tmp/artifacts-${id}`,
      worktreePath: `/tmp/worktrees-${id}`,
    });
  }

  it("rapid run switching updates cache only for active target", () => {
    const { runRepo } = setupTest();

    const runA = createTestRun("run-switch-A", runRepo);
    const runB = createTestRun("run-switch-B", runRepo);
    const runC = createTestRun("run-switch-C", runRepo);

    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(runA.id), runA);
    queryClient.setQueryData(queryKeys.run(runB.id), runB);
    queryClient.setQueryData(queryKeys.run(runC.id), runC);

    let activeRunId = runA.id;
    const onEvent = (targetRunId: string, newStatus: RunStatus) => {
      if (targetRunId === activeRunId) {
        patchRunCache(targetRunId, { status: newStatus }, queryClient);
      }
    };

    // 1. Switch to B
    activeRunId = runB.id;
    // 2. Switch to C
    activeRunId = runC.id;
    // 3. Switch back to A
    activeRunId = runA.id;

    // Discarded event for B
    onEvent(runB.id, "failed");
    // Active event for A
    onEvent(runA.id, "verifying");

    // Run B cache was NOT modified
    const cachedB = queryClient.getQueryData<Run>(queryKeys.run(runB.id));
    expect(cachedB?.status).toBe("implementing");

    // Run A cache updated
    const cachedA = queryClient.getQueryData<Run>(queryKeys.run(runA.id));
    expect(cachedA?.status).toBe("verifying");
  });

  it("abrupt SSE connection abort cleans up SSE registry completely", async () => {
    const { runRepo } = setupTest();
    const run = createTestRun("run-disconnect-test", runRepo);

    const initialCount = defaultSSERegistry.count;

    // 1. Client connects via SSE
    const req = new Request(`http://localhost/api/runs/${run.id}/events`);
    const res = await handleApi(req, new URL(req.url));
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    expect(defaultSSERegistry.count).toBe(initialCount + 1);

    // 2. Client abruptly disconnects / cancels stream
    await reader?.cancel();

    // Allow cancel callback in ReadableStream to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(defaultSSERegistry.count).toBe(initialCount);
  });

  it("streams events independently to distinct run subscribers without cross-talk", async () => {
    const { runRepo, eventRepo } = setupTest();
    const run1 = createTestRun("run-multi-sub-1", runRepo);
    const run2 = createTestRun("run-multi-sub-2", runRepo);

    // Connect client to Run 1
    const req1 = new Request(`http://localhost/api/runs/${run1.id}/events`);
    const res1 = await handleApi(req1, new URL(req1.url));
    const reader1 = res1.body?.getReader();
    expect(reader1).toBeDefined();

    // Connect client to Run 2
    const req2 = new Request(`http://localhost/api/runs/${run2.id}/events`);
    const res2 = await handleApi(req2, new URL(req2.url));
    const reader2 = res2.body?.getReader();
    expect(reader2).toBeDefined();

    // Append events to SQLite
    eventRepo.appendEvent(run1.id, "info", { text: "Run 1 unique payload" });
    eventRepo.appendEvent(run2.id, "pr_step", { text: "Run 2 unique payload" });

    // Read from client 1
    const read1Promise = reader1?.read();
    const val1 = await read1Promise;
    const text1 = new TextDecoder().decode(val1?.value);
    expect(text1).toContain("Run 1 unique payload");
    expect(text1).not.toContain("Run 2 unique payload");

    // Read from client 2
    const read2Promise = reader2?.read();
    const val2 = await read2Promise;
    const text2 = new TextDecoder().decode(val2?.value);
    expect(text2).toContain("Run 2 unique payload");
    expect(text2).not.toContain("Run 1 unique payload");

    await reader1?.cancel();
    await reader2?.cancel();
  });
});
