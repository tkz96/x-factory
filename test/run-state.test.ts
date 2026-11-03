// test/run-state.test.ts — Client run-state module: pure reducer, replay and polling policy (#191).
// Seam: the reducer and subscriber are fed event sequences recorded from the real EventRepository,
// serialised through the server's wire converter. The transport is the only fake.

import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createDatabase } from "../src/db/connection.js";
import type { EventRecord } from "../src/db/event-repository.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  cacheRunAfterMutation,
  insertRunEvent,
  type RunEventTransport,
  type RunEventTransportHandlers,
  reduceRun,
  runPollIntervalMs,
  runRefetchInterval,
  runStreamPlan,
  subscribeRunEvents,
} from "../src/frontend/lib/run-state.js";
import { toWireEvent } from "../src/http/responses.js";
import type {
  PullRequest,
  ReviewResult,
  Run,
  RunEvent,
  RunEventPayloadMap,
  RunEventType,
  RunStatus,
  VerificationResult,
} from "../src/shared/types.js";

const RUN_ID = "run-state-test";

const sampleVerification: VerificationResult = {
  passed: true,
  repairAttempt: 2,
  tests: {
    command: "bun test",
    passed: true,
    exitCode: 0,
    stdout: "10 pass, 0 fail",
    stderr: "",
    durationMs: 50,
  },
  diff: "diff --git a/src/app.ts b/src/app.ts\n+ console.log('verified');",
  filesChanged: ["src/app.ts"],
  hasPollution: false,
  summary: "All 10 tests passed without pollution.",
};

const sampleReview: ReviewResult = {
  passed: true,
  findings: [
    { severity: "info", message: "Clean implementation", file: "src/app.ts" },
  ],
  criteriaChecked: [{ criterion: "AC 1: Must verify", status: "pass" }],
  summary: "All acceptance criteria verified and code quality approved.",
};

const samplePr: PullRequest = {
  url: "https://github.com/acme/app/pull/7",
  branch: "factory/run-state",
  baseBranch: "main",
  title: "Run state",
};

function runSnapshot(status: RunStatus): Run {
  return {
    id: RUN_ID,
    project: { id: "proj-1", name: "Project 1" },
    ticket: { id: "T-1", title: "Run state", acceptanceCriteria: [] },
    plan: "plan",
    branch: "factory/run-state",
    status,
    startedAt: "2026-10-01T10:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  };
}

/** Records a complete delivered run through the real event repository. */
function recordDeliveredRun(): EventRecord[] {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  new RunRepository(db).create({
    id: RUN_ID,
    projectId: "proj-1",
    projectName: "Project 1",
    ticket: { id: "T-1", title: "Run state", acceptanceCriteria: [] },
    plan: "plan",
    branch: "factory/run-state",
    status: "queued",
    artifactsDir: "/tmp/run-state-artifacts",
    worktreePath: "/tmp/run-state-worktree",
  });
  const eventRepo = new EventRepository(db);
  const append = <T extends RunEventType>(
    type: T,
    payload: RunEventPayloadMap[T],
  ) => eventRepo.appendEvent(RUN_ID, type, payload);

  append("status", { status: "preparing" });
  append("status", { status: "understanding" });
  append("chat_agent", { text: "Which tests should cover this?" });
  append("status", { status: "awaiting_understanding_approval" });
  append("chat_user", { text: "Cover the replay path." });
  append("status", { status: "planning" });
  append("status", { status: "awaiting_plan_approval" });
  append("status", { status: "executing" });
  append("ralph_progress", { text: "iteration 1", iteration: 1 });
  append("verification", { result: sampleVerification });
  append("review", { result: sampleReview });
  append("status", { status: "awaiting_review" });
  append("status", { status: "ready_for_pr" });
  append("status", { status: "pr_created", pullRequest: samplePr });
  return eventRepo.getEventsForRun(RUN_ID);
}

/** A transport that replays the given records as the server's SSE stream would. */
function replayTransport(records: EventRecord[]) {
  const opened: string[] = [];
  let closed = 0;
  let handlers: RunEventTransportHandlers | null = null;
  const transport: RunEventTransport = (runId, _cursor, h) => {
    opened.push(runId);
    handlers = h;
    h.onOpen();
    for (const record of records) {
      h.onMessage(JSON.stringify(toWireEvent(record)));
    }
    return () => {
      closed += 1;
    };
  };
  return {
    transport,
    opened,
    get closed() {
      return closed;
    },
    fail() {
      handlers?.onError(true);
    },
  };
}

function eventsOf(queryClient: QueryClient): RunEvent[] {
  return (
    queryClient.getQueryData<RunEvent[]>(queryKeys.runEvents(RUN_ID)) ?? []
  );
}

function statusOf(queryClient: QueryClient): RunStatus | undefined {
  return queryClient.getQueryData<Run>(queryKeys.run(RUN_ID))?.status;
}

describe("client run-state module (#191)", () => {
  it("a finished run's history is replayed into the event log and keeps its terminal status", () => {
    const records = recordDeliveredRun();
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("pr_created"));
    const stream = replayTransport(records);

    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: true,
      transport: stream.transport,
    });

    expect(stream.opened).toEqual([RUN_ID]);
    expect(eventsOf(queryClient)).toHaveLength(14);
    expect(eventsOf(queryClient).map((e) => e.type)).toContain("chat_user");
    expect(statusOf(queryClient)).toBe("pr_created");
    const run = queryClient.getQueryData<Run>(queryKeys.run(RUN_ID));
    expect(run?.verification).toEqual(sampleVerification);
    expect(run?.review).toEqual(sampleReview);
    expect(run?.repairAttempts).toBe(2);
    expect(run?.pullRequest).toEqual(samplePr);
  });

  it("a replay-only stream that the server closes is not reopened", () => {
    const records = recordDeliveredRun();
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("pr_created"));
    const stream = replayTransport(records);

    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: true,
      transport: stream.transport,
    });
    stream.fail();

    expect(stream.opened).toHaveLength(1);
    expect(stream.closed).toBe(1);
  });

  it("reconnect replay of duplicate events does not move status backwards or duplicate the log", () => {
    const records = recordDeliveredRun();
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      queryKeys.run(RUN_ID),
      runSnapshot("ready_for_pr"),
    );
    const stream = replayTransport(records.slice(0, 8));

    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: stream.transport,
    });
    // The fresh snapshot is ahead of the replayed history.
    expect(statusOf(queryClient)).toBe("ready_for_pr");

    // A second reconnect replays the full history over the first 8 events.
    const full = replayTransport(records);
    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: full.transport,
    });
    expect(eventsOf(queryClient)).toHaveLength(14);
    expect(statusOf(queryClient)).toBe("pr_created");
  });

  it("the reducer never applies a status the transition matrix forbids", () => {
    const run = runSnapshot("ready_for_pr");
    const stale = toWireEvent({
      sequence: 3,
      type: "status",
      payload: { status: "executing" },
      createdAt: "2026-10-01T10:01:00.000Z",
    }) as RunEvent;
    expect(reduceRun(run, stale).status).toBe("ready_for_pr");
  });

  it("a replayed historical status event older than the snapshot does not regress status (#163)", () => {
    // awaiting_review -> understanding is a legal transition in TRANSITIONS (e.g. user feedback),
    // but an older replayed event from earlier in the run must not regress a reopened run snapshot.
    const run: Run = {
      ...runSnapshot("awaiting_review"),
      updatedAt: "2026-10-01T10:30:00.000Z",
    };

    const oldReplayedEvent: RunEvent = {
      id: 2,
      timestamp: "2026-10-01T10:05:00.000Z",
      type: "status",
      payload: { status: "understanding" },
    };

    // Stale historical event older than updatedAt must not regress status
    expect(reduceRun(run, oldReplayedEvent).status).toBe("awaiting_review");

    // A newer event (live transition after review feedback) must be applied
    const newLiveEvent: RunEvent = {
      id: 15,
      timestamp: "2026-10-01T10:35:00.000Z",
      type: "status",
      payload: { status: "understanding" },
    };

    const updated = reduceRun(run, newLiveEvent);
    expect(updated.status).toBe("understanding");
    expect(updated.updatedAt).toBe("2026-10-01T10:35:00.000Z");
  });

  it("a live verification or review the snapshot does not hold applies, even when a status event moved updatedAt past it", () => {
    const run: Run = {
      ...runSnapshot("awaiting_review"),
      updatedAt: "2026-10-01T10:30:00.000Z",
      verification: { ...sampleVerification, repairAttempt: 1 },
      review: null,
    };
    const newerVerification: RunEvent = {
      id: 40,
      timestamp: "2026-10-01T10:20:00.000Z",
      type: "verification",
      payload: {
        result: {
          ...sampleVerification,
          repairAttempt: 2,
          summary: "Newer verification",
        },
      },
    };
    const liveReview: RunEvent = {
      id: 41,
      timestamp: "2026-10-01T10:21:00.000Z",
      type: "review",
      payload: { result: { ...sampleReview, summary: "Live review" } },
    };
    expect(reduceRun(run, newerVerification).verification?.summary).toBe(
      "Newer verification",
    );
    expect(reduceRun(run, liveReview).review?.summary).toBe("Live review");
  });

  it("a replayed historical verification or review event older than the snapshot does not overwrite the snapshot (#317)", () => {
    const run: Run = {
      ...runSnapshot("awaiting_review"),
      updatedAt: "2026-10-01T10:30:00.000Z",
      verification: sampleVerification,
      review: sampleReview,
      repairAttempts: 2,
      diff: "current diff",
    };

    const staleVerification: RunEvent = {
      id: 2,
      timestamp: "2026-10-01T10:05:00.000Z",
      type: "verification",
      payload: {
        result: {
          ...sampleVerification,
          repairAttempt: 0,
          summary: "Old verification result",
          diff: "old diff",
        },
      },
    };

    const staleReview: RunEvent = {
      id: 3,
      timestamp: "2026-10-01T10:06:00.000Z",
      type: "review",
      payload: {
        result: {
          ...sampleReview,
          summary: "Old review result",
        },
      },
    };

    expect(reduceRun(run, staleVerification).verification?.summary).toBe(
      sampleVerification.summary,
    );
    expect(reduceRun(run, staleVerification).diff).toBe("current diff");
    expect(reduceRun(run, staleReview).review?.summary).toBe(
      sampleReview.summary,
    );

    const freshVerification: RunEvent = {
      id: 20,
      timestamp: "2026-10-01T10:35:00.000Z",
      type: "verification",
      payload: {
        result: {
          ...sampleVerification,
          summary: "New fresh verification result",
        },
      },
    };
    expect(reduceRun(run, freshVerification).verification?.summary).toBe(
      "New fresh verification result",
    );
  });

  it("insertRunEvent appends in O(1) when the id is greater than the last id, and handles out-of-order and duplicates (#317)", () => {
    const e1: RunEvent = {
      id: 1,
      type: "info",
      timestamp: "2026-10-01T10:00:00.000Z",
      payload: { text: "one" },
    };
    const e2: RunEvent = {
      id: 2,
      type: "info",
      timestamp: "2026-10-01T10:01:00.000Z",
      payload: { text: "two" },
    };
    const e3: RunEvent = {
      id: 3,
      type: "info",
      timestamp: "2026-10-01T10:02:00.000Z",
      payload: { text: "three" },
    };
    const e5: RunEvent = {
      id: 5,
      type: "info",
      timestamp: "2026-10-01T10:04:00.000Z",
      payload: { text: "five" },
    };
    const e4: RunEvent = {
      id: 4,
      type: "info",
      timestamp: "2026-10-01T10:03:00.000Z",
      payload: { text: "four" },
    };

    // Appending to empty
    let log = insertRunEvent([], e1);
    expect(log).toEqual([e1]);

    // Fast path: id > last.id
    log = insertRunEvent(log, e2);
    expect(log).toEqual([e1, e2]);

    log = insertRunEvent(log, e3);
    log = insertRunEvent(log, e5);
    expect(log).toEqual([e1, e2, e3, e5]);

    // Duplicate returns the same array instance
    expect(insertRunEvent(log, e5)).toBe(log);
    expect(insertRunEvent(log, e2)).toBe(log);

    // Out-of-order insertion
    const withFour = insertRunEvent(log, e4);
    expect(withFour.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("real run-detail API payload carries updatedAt and works in reduceRun without casts (#163)", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const record = runRepo.create({
      id: "run-wire-shape",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Run state", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/run-state",
      status: "queued",
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktree",
    });

    // The API response is serialized from the repository record (which carries updatedAt)
    const apiPayload: Run = JSON.parse(JSON.stringify(record));
    expect(typeof apiPayload.updatedAt).toBe("string");
    expect(new Date(apiPayload.updatedAt).getTime()).not.toBeNaN();

    // Verify reduceRun consumes this real API shape directly with no cast
    const liveEvent: RunEvent = {
      id: 1,
      timestamp: new Date(Date.now() + 10000).toISOString(),
      type: "status",
      payload: { status: "preparing" },
    };
    const updated = reduceRun(apiPayload, liveEvent);
    expect(updated.status).toBe("preparing");
    expect(updated.updatedAt).toBe(liveEvent.timestamp);
  });

  it("invalidates the run once per burst of events, not once per event", async () => {
    const records = recordDeliveredRun();
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("queued"));
    const invalidations: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters, options) => {
      invalidations.push(filters?.queryKey);
      return original(filters, options);
    };

    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: replayTransport(records).transport,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(invalidations).toEqual([["runs", RUN_ID]]);
  });

  it("stage_started adds the attempt's model to the run once, even when replayed (#279)", () => {
    const event = {
      id: 7,
      timestamp: "2026-10-01T10:00:00.000Z",
      type: "stage_started",
      payload: {
        stage: "review",
        attempt: 1,
        model: {
          role: "reviewer",
          connectionId: "c1",
          connectionName: "Gemini",
          apiType: "gemini",
          modelId: "gemini-x",
        },
      },
    } as RunEvent;
    const once = reduceRun(runSnapshot("executing"), event);
    const twice = reduceRun(once, event);
    expect(twice.stageModels).toEqual([
      {
        role: "reviewer",
        connectionId: "c1",
        connectionName: "Gemini",
        apiType: "gemini",
        modelId: "gemini-x",
        stage: "review",
        step: "review",
        attempt: 1,
        startedAt: "2026-10-01T10:00:00.000Z",
      },
    ]);
  });

  it("stage_started keeps coding and its review as separate steps of one execute attempt", () => {
    const model = {
      connectionId: "c1",
      connectionName: "Gemini",
      apiType: "gemini",
    };
    const coding = {
      id: 8,
      timestamp: "2026-10-01T10:00:00.000Z",
      type: "stage_started",
      payload: {
        stage: "execute",
        step: "execute",
        attempt: 1,
        model: { ...model, role: "builder", modelId: "builder-x" },
      },
    } as RunEvent;
    const review = {
      id: 9,
      timestamp: "2026-10-01T10:05:00.000Z",
      type: "stage_started",
      payload: {
        stage: "execute",
        step: "review",
        attempt: 1,
        model: { ...model, role: "reviewer", modelId: "reviewer-x" },
      },
    } as RunEvent;
    const run = reduceRun(
      reduceRun(reduceRun(runSnapshot("executing"), coding), review),
      review,
    );
    expect(run.stageModels?.map((m) => [m.step, m.role, m.modelId])).toEqual([
      ["execute", "builder", "builder-x"],
      ["review", "reviewer", "reviewer-x"],
    ]);
  });

  it("the reducer handles every event type in the shared union", () => {
    const samples: { [K in RunEventType]: RunEventPayloadMap[K] } = {
      status: { status: "awaiting_review" },
      stage_evidence: { stage: "execute", evidence: "tests pass" },
      pr_step: { step: "push", text: "Pushed" },
      chat_user: { text: "hello" },
      chat_agent: { text: "hi" },
      user_feedback: { text: "Rework" },
      pi_output_chunk: { text: "chunk", role: "assistant" },
      verification: { result: sampleVerification },
      review: { result: sampleReview },
      ralph_progress: { text: "iteration 2", iteration: 2 },
      plan_ready: { plan: "1. Do the thing" },
      diff_summary: {
        files: [{ path: "src/app.ts", added: 2, removed: 1 }],
        totalAdded: 2,
        totalRemoved: 1,
      },
      review_activity: { tool: "read", text: "Running tool read" },
      info: { text: "info" },
      error: { message: "boom" },
      pr_merged: {
        url: "https://github.com/org/repo/pull/1",
        mergedAt: "2026-10-12T12:00:00Z",
        mergedBy: "octocat",
      },
      pr_closed: {
        url: "https://github.com/org/repo/pull/1",
        closedAt: "2026-10-12T12:00:00Z",
      },
      stage_started: {
        stage: "execute",
        attempt: 1,
        model: {
          role: "builder",
          connectionId: "c1",
          connectionName: "Gemini",
          apiType: "gemini",
          modelId: "gemini-x",
        },
      },
    };
    const run = runSnapshot("executing");
    for (const type of Object.keys(samples) as RunEventType[]) {
      const event = {
        id: 1,
        timestamp: "2026-10-01T10:00:00.000Z",
        type,
        payload: samples[type],
      } as RunEvent;
      expect(reduceRun(run, event)).toBeDefined();
    }

    const mergedRun = reduceRun(run, {
      id: 2,
      timestamp: "2026-10-12T12:00:00Z",
      type: "pr_merged",
      payload: samples.pr_merged,
    });
    expect(mergedRun.pullRequestOutcome).toEqual({
      status: "merged",
      state: "merged",
      url: "https://github.com/org/repo/pull/1",
      mergedAt: "2026-10-12T12:00:00Z",
      mergedBy: "octocat",
    });

    const closedRun = reduceRun(run, {
      id: 3,
      timestamp: "2026-10-12T12:00:00Z",
      type: "pr_closed",
      payload: samples.pr_closed,
    });
    expect(closedRun.pullRequestOutcome).toEqual({
      status: "closed",
      state: "closed",
      url: "https://github.com/org/repo/pull/1",
      closedAt: "2026-10-12T12:00:00Z",
    });
  });

  it("polls an active run every 2 seconds and never a finished one", () => {
    expect(runPollIntervalMs(runSnapshot("executing"))).toBe(2000);
    expect(runPollIntervalMs(runSnapshot("recovery_required"))).toBe(2000);
    expect(runPollIntervalMs(runSnapshot("pr_created"))).toBe(false);
    expect(runPollIntervalMs(undefined)).toBe(false);
  });

  it("stop() flushes the pending invalidation at once and cancels its timer", async () => {
    const records = recordDeliveredRun();
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("queued"));
    let invalidations = 0;
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters, options) => {
      invalidations += 1;
      return original(filters, options);
    };
    const stop = subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: replayTransport(records).transport,
    });
    stop();
    expect(invalidations).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(invalidations).toBe(1);
  });

  it("a dropped stream leaves the run's polling fallback in place", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("executing"));
    const stream = replayTransport([]);
    const stop = subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: stream.transport,
    });
    stream.fail();
    stop();

    // The polling interval depends on the run, never on the stream, so a drop cannot disable it.
    const run = queryClient.getQueryData<Run>(queryKeys.run(RUN_ID));
    expect(runRefetchInterval({ state: { data: run } })).toBe(2000);
  });

  it("runStreamPlan subscribes live for an active run, replay-only for a finished one, and waits for the snapshot", () => {
    expect(runStreamPlan(undefined)).toBeNull();
    expect(runStreamPlan(runSnapshot("executing"))).toEqual({
      replayOnly: false,
    });
    expect(runStreamPlan(runSnapshot("pr_created"))).toEqual({
      replayOnly: true,
    });
  });

  it("cacheRunAfterMutation writes the run snapshot and marks the runs list stale", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.runs(), [runSnapshot("stopped")]);
    cacheRunAfterMutation(queryClient, runSnapshot("queued"));
    expect(queryClient.getQueryData<Run>(queryKeys.run(RUN_ID))?.status).toBe(
      "queued",
    );
    expect(queryClient.getQueryState(queryKeys.runs())?.isInvalidated).toBe(
      true,
    );
  });
});

// ─── Live stream reopened after the browser gives up (permanent failure) ─────

/** A transport whose connections the test drives by hand. */
function controlledTransport() {
  const connections: {
    runId: string;
    cursor: number;
    handlers: RunEventTransportHandlers;
    closed: boolean;
  }[] = [];
  const transport: RunEventTransport = (runId, cursor, handlers) => {
    const connection = { runId, cursor, handlers, closed: false };
    connections.push(connection);
    return () => {
      connection.closed = true;
    };
  };
  return { transport, connections };
}

/** Timers the test advances by hand; records each requested delay. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [];
  const timers = {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      delays.push(ms);
      pending.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id: ReturnType<typeof setTimeout>) {
      pending.delete(id as unknown as number);
    },
  };
  return {
    timers,
    delays,
    pendingCount: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

function wire(id: number, text: string): string {
  return JSON.stringify({
    id,
    type: "chat_agent",
    payload: { text },
    timestamp: "2026-10-01T10:00:00.000Z",
  });
}

describe("live run stream reopens after a permanent failure (#191)", () => {
  function liveSetup() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("executing"));
    const stream = controlledTransport();
    const clock = manualTimers();
    const connected: boolean[] = [];
    const stop = subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: false,
      transport: stream.transport,
      timers: clock.timers,
      onConnectionChange: (value) => connected.push(value),
    });
    return { queryClient, stream, clock, connected, stop };
  }

  it("(a) after a permanent failure, reopens from the last applied id and keeps the log in order", () => {
    const { queryClient, stream, clock, connected } = liveSetup();
    const first = stream.connections[0];
    first?.handlers.onOpen();
    first?.handlers.onMessage(wire(1, "one"));
    first?.handlers.onMessage(wire(2, "two"));

    first?.handlers.onError(true);
    expect(connected).toEqual([true, false]);
    expect(stream.connections).toHaveLength(1);

    clock.advance(1000);
    expect(stream.connections).toHaveLength(2);
    const second = stream.connections[1];
    expect(second?.cursor).toBe(2);

    second?.handlers.onOpen();
    second?.handlers.onMessage(wire(2, "two"));
    second?.handlers.onMessage(wire(3, "three"));

    expect(eventsOf(queryClient).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(connected).toEqual([true, false, true]);
  });

  it("(b) a transient error, where the browser retries itself, opens no second connection", () => {
    const { stream, clock, connected } = liveSetup();
    const first = stream.connections[0];
    first?.handlers.onOpen();
    first?.handlers.onError(false);

    expect(connected).toEqual([true, false]);
    clock.advance(60_000);
    expect(stream.connections).toHaveLength(1);
    expect(clock.delays).toHaveLength(0);
  });

  it("(c) stop() during the backoff opens nothing more", () => {
    const { stream, clock, stop } = liveSetup();
    stream.connections[0]?.handlers.onError(true);
    stop();
    clock.advance(60_000);

    expect(stream.connections).toHaveLength(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("stop() closes the open connection", () => {
    const { stream, stop } = liveSetup();
    stop();
    expect(stream.connections[0]?.closed).toBe(true);
  });

  it("(d) a replay-only stream that fails permanently still just stops", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("pr_created"));
    const stream = controlledTransport();
    const clock = manualTimers();
    subscribeRunEvents({
      queryClient,
      runId: RUN_ID,
      replayOnly: true,
      transport: stream.transport,
      timers: clock.timers,
    });
    stream.connections[0]?.handlers.onError(true);
    clock.advance(60_000);

    expect(stream.connections).toHaveLength(1);
    expect(stream.connections[0]?.closed).toBe(true);
    expect(clock.delays).toHaveLength(0);
  });

  it("(f) a run that went terminal while disconnected gets one final catch-up from the last applied id", () => {
    const { queryClient, stream, clock } = liveSetup();
    const first = stream.connections[0];
    first?.handlers.onOpen();
    first?.handlers.onMessage(wire(1, "one"));
    // The run finishes while the stream is down: the snapshot is refreshed, the tail is missing.
    queryClient.setQueryData(queryKeys.run(RUN_ID), runSnapshot("failed"));
    first?.handlers.onError(true);

    expect(stream.connections).toHaveLength(2);
    const catchUp = stream.connections[1];
    expect(catchUp?.cursor).toBe(1);
    catchUp?.handlers.onMessage(wire(2, "tail"));
    expect(eventsOf(queryClient).map((e) => e.id)).toEqual([1, 2]);

    // The catch-up ends the way a replay does: no third connection.
    catchUp?.handlers.onError(true);
    clock.advance(60_000);
    expect(stream.connections).toHaveLength(2);
    expect(catchUp?.closed).toBe(true);
  });

  it("(e) repeated permanent failures back off from 1 s, double, cap at 30 s, and reset on a successful open", () => {
    const { stream, clock } = liveSetup();
    for (let i = 0; i < 7; i += 1) {
      stream.connections[stream.connections.length - 1]?.handlers.onError(true);
      clock.advance(clock.delays[clock.delays.length - 1] ?? 0);
    }
    expect(clock.delays).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
    ]);

    // A connection that opens resets the backoff.
    stream.connections[stream.connections.length - 1]?.handlers.onOpen();
    stream.connections[stream.connections.length - 1]?.handlers.onError(true);
    expect(clock.delays[clock.delays.length - 1]).toBe(1000);
  });
});
