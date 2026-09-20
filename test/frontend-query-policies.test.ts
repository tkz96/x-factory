// test/frontend-query-policies.test.ts — Unit tests for TanStack Query policies, targeted invalidation & SSE patching (XFM-40, XFM-41, XFM-42, XFM-43).

import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  invalidateProject,
  invalidateProjects,
  invalidateRun,
  invalidateRuns,
  invalidateSettings,
  invalidateTickets,
  patchRunCache,
} from "../src/frontend/lib/query-client.js";
import {
  QUERY_POLICIES,
  queryKeys,
} from "../src/frontend/lib/query-policies.js";
import type { Run } from "../src/shared/types.js";

describe("TanStack Query Freshness Policies (XFM-41)", () => {
  it("defines explicit freshness policy for every server-state resource", () => {
    // Settings: 5 min, no refetching
    expect(QUERY_POLICIES.settings.staleTime).toBe(300000);
    expect(QUERY_POLICIES.settings.refetchOnWindowFocus).toBe(false);
    expect(QUERY_POLICIES.settings.refetchOnReconnect).toBe(false);
    expect(QUERY_POLICIES.settings.refetchOnMount).toBe(false);

    // Projects: 2 min
    expect(QUERY_POLICIES.projects.staleTime).toBe(120000);
    expect(QUERY_POLICIES.projects.refetchOnWindowFocus).toBe(false);
    expect(QUERY_POLICIES.projects.refetchOnReconnect).toBe(false);

    // Tickets: 60s
    expect(QUERY_POLICIES.tickets.staleTime).toBe(60000);
    expect(QUERY_POLICIES.tickets.refetchOnWindowFocus).toBe(false);

    // Runs list: 15s, refetch on window focus and reconnect
    expect(QUERY_POLICIES.runs.staleTime).toBe(15000);
    expect(QUERY_POLICIES.runs.refetchOnWindowFocus).toBe(true);
    expect(QUERY_POLICIES.runs.refetchOnReconnect).toBe(true);

    // Run detail: 10s
    expect(QUERY_POLICIES.run.staleTime).toBe(10000);

    // Readiness: 60s
    expect(QUERY_POLICIES.readiness.staleTime).toBe(60000);
  });

  it("provides deterministic query key factories", () => {
    expect(queryKeys.projects()).toEqual(["projects"]);
    expect(queryKeys.project("p1")).toEqual(["projects", "p1"]);
    expect(queryKeys.tickets("p1")).toEqual(["tickets", "p1"]);
    expect(queryKeys.runs()).toEqual(["runs"]);
    expect(queryKeys.run("r1")).toEqual(["runs", "r1"]);
    expect(queryKeys.settings()).toEqual(["settings"]);
    expect(queryKeys.readiness()).toEqual(["readiness"]);
  });
});

describe("Direct SSE Cache Patching (XFM-42)", () => {
  function createTestRun(id: string, status: Run["status"]): Run {
    return {
      id,
      project: { id: "proj-test", name: "Test Project" },
      ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
      plan: "Test plan",
      branch: "factory/t-1",
      status,
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      implementationContext: null,
      verification: null,
      review: null,
      artifacts: [],
      diff: null,
      pullRequest: null,
      repairAttempts: 0,
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktrees",
    };
  }

  it("patches specific run detail and runs collection directly without refetching", () => {
    const client = new QueryClient();

    const run1 = createTestRun("run-1", "preparing");
    const run2 = createTestRun("run-2", "queued");

    // Populate initial caches
    client.setQueryData(queryKeys.run("run-1"), run1);
    client.setQueryData(queryKeys.run("run-2"), run2);
    client.setQueryData(queryKeys.runs(), [run1, run2]);

    // Track query state before patch
    const runsListQueryBefore = client
      .getQueryCache()
      .find({ queryKey: queryKeys.runs() });
    const run1QueryBefore = client
      .getQueryCache()
      .find({ queryKey: queryKeys.run("run-1") });

    expect(runsListQueryBefore?.state.data).toEqual([run1, run2]);
    expect(run1QueryBefore?.state.data).toEqual(run1);

    // Apply direct patch: status -> implementing, diff -> "modified files"
    patchRunCache(
      "run-1",
      {
        status: "implementing",
        diff: "diff --git a/file.ts b/file.ts",
      },
      client,
    );

    // Check individual run cache updated
    const updatedRun1 = client.getQueryData<Run>(queryKeys.run("run-1"));
    expect(updatedRun1?.status).toBe("implementing");
    expect(updatedRun1?.diff).toBe("diff --git a/file.ts b/file.ts");

    // Check runs collection cache updated for run-1, preserving run-2
    const updatedRunsList = client.getQueryData<Run[]>(queryKeys.runs());
    expect(updatedRunsList).toBeDefined();
    expect(updatedRunsList?.[0]?.status).toBe("implementing");
    expect(updatedRunsList?.[0]?.diff).toBe("diff --git a/file.ts b/file.ts");
    expect(updatedRunsList?.[1]?.status).toBe("queued");

    // Run-2 individual cache remains untouched
    const updatedRun2 = client.getQueryData<Run>(queryKeys.run("run-2"));
    expect(updatedRun2?.status).toBe("queued");
  });

  it("patches run cache using a function updater", () => {
    const client = new QueryClient();
    const run1 = createTestRun("run-1", "preparing");
    client.setQueryData(queryKeys.run("run-1"), run1);
    client.setQueryData(queryKeys.runs(), [run1]);

    patchRunCache(
      "run-1",
      (prev) => (prev ? { ...prev, status: "pr_created" } : undefined),
      client,
    );

    const updatedRun = client.getQueryData<Run>(queryKeys.run("run-1"));
    expect(updatedRun?.status).toBe("pr_created");

    const updatedRuns = client.getQueryData<Run[]>(queryKeys.runs());
    expect(updatedRuns?.[0]?.status).toBe("pr_created");
  });
});

describe("Explicit Targeted Invalidation (XFM-43)", () => {
  it("invalidates only target resource without full cache clearing", async () => {
    const client = new QueryClient();

    client.setQueryData(queryKeys.projects(), [{ id: "p1", name: "P1" }]);
    client.setQueryData(queryKeys.project("p1"), { id: "p1", name: "P1" });
    client.setQueryData(queryKeys.tickets("p1"), [{ id: "T-1", title: "T1" }]);
    client.setQueryData(queryKeys.runs(), []);
    client.setQueryData(queryKeys.run("r1"), { id: "r1" });
    client.setQueryData(queryKeys.settings(), { limits: { maxRuns: 5 } });

    // Target invalidation of projects
    await invalidateProjects(client);

    const projectsQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.projects() });
    const singleProjectQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.project("p1") });
    const ticketsQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.tickets("p1") });
    const runsQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.runs() });
    const singleRunQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.run("r1") });
    const settingsQuery = client
      .getQueryCache()
      .find({ queryKey: queryKeys.settings() });

    // Projects query marked isStale = true
    expect(projectsQuery?.isStale()).toBe(true);

    // Other resources remain fresh (isStale = false)
    expect(ticketsQuery?.isStale()).toBe(false);
    expect(runsQuery?.isStale()).toBe(false);
    expect(settingsQuery?.isStale()).toBe(false);

    // Target invalidation of single project
    await invalidateProject("p1", client);
    expect(singleProjectQuery?.isStale()).toBe(true);

    // Target invalidation of tickets for p1
    await invalidateTickets("p1", client);
    expect(ticketsQuery?.isStale()).toBe(true);
    expect(runsQuery?.isStale()).toBe(false);

    // Target invalidation of runs
    await invalidateRuns(client);
    expect(runsQuery?.isStale()).toBe(true);
    expect(settingsQuery?.isStale()).toBe(false);

    // Target invalidation of single run
    await invalidateRun("r1", client);
    expect(singleRunQuery?.isStale()).toBe(true);

    // Target invalidation of settings
    await invalidateSettings(client);
    expect(settingsQuery?.isStale()).toBe(true);
  });
});
