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
  criteriaChecked: [{ criterion: "AC 1: Must verify", satisfied: true }],
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
  const transport: RunEventTransport = (runId, h) => {
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
      handlers?.onError();
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
      info: { text: "info" },
      error: { message: "boom" },
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
