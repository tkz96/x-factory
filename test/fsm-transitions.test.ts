// test/fsm-transitions.test.ts — Unit tests for atomic FSM transitions, concurrency guard, and event persistence (XFM-08, XFM-09, XFM-14).

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import {
  IllegalStateTransitionError,
  RunNotFoundError,
  RunRepository,
  StaleRevisionError,
} from "../src/db/run-repository.js";
import type { RunStatus } from "../src/shared/types.js";
import { canTransition } from "../src/state-machine.js";

describe("Atomic FSM Transitions & Concurrency Guard (XFM-08, XFM-09, XFM-14)", () => {
  let db: Database;
  let runRepo: RunRepository;
  let eventRepo: EventRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    runRepo = new RunRepository(db);
    eventRepo = new EventRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function createTestRun(
    id = "test-run-1",
    initialStatus: RunStatus = "queued",
  ) {
    return runRepo.create({
      id,
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: {
        id: "TICK-1",
        title: "Test Ticket",
        acceptanceCriteria: ["Must work"],
      },
      plan: "Step 1",
      branch: "feat/tick-1",
      status: initialStatus,
      artifactsDir: "/tmp/runs/test-run-1",
      worktreePath: "/tmp/worktree/test-run-1",
    });
  }

  it("succeeds through legal happy path state transitions", () => {
    createTestRun("run-happy", "queued");

    const r1 = runRepo.transitionRun("run-happy", "queued", "preparing");
    expect(r1.status).toBe("preparing");
    expect(r1.revision).toBe(2);

    const r2 = runRepo.transitionRun("run-happy", "preparing", "understanding");
    expect(r2.status).toBe("understanding");
    expect(r2.revision).toBe(3);

    const r3 = runRepo.transitionRun(
      "run-happy",
      "understanding",
      "implementing",
    );
    expect(r3.status).toBe("implementing");
    expect(r3.revision).toBe(4);

    const r4 = runRepo.transitionRun("run-happy", "implementing", "verifying");
    expect(r4.status).toBe("verifying");
    expect(r4.revision).toBe(5);

    const r5 = runRepo.transitionRun("run-happy", "verifying", "reviewing");
    expect(r5.status).toBe("reviewing");
    expect(r5.revision).toBe(6);

    const r6 = runRepo.transitionRun("run-happy", "reviewing", "ready_for_pr");
    expect(r6.status).toBe("ready_for_pr");
    expect(r6.revision).toBe(7);

    const r7 = runRepo.transitionRun("run-happy", "ready_for_pr", "pr_created");
    expect(r7.status).toBe("pr_created");
    expect(r7.revision).toBe(8);
    expect(r7.finishedAt).not.toBeNull();
  });

  it("handles recovery_required state transitions (resume and abandon)", () => {
    createTestRun("run-recovery", "implementing");

    // Any active state can transition to recovery_required
    const r1 = runRepo.transitionRun(
      "run-recovery",
      "implementing",
      "recovery_required",
    );
    expect(r1.status).toBe("recovery_required");
    expect(r1.revision).toBe(2);

    // recovery_required can resume back to implementing
    const r2 = runRepo.transitionRun(
      "run-recovery",
      "recovery_required",
      "implementing",
    );
    expect(r2.status).toBe("implementing");
    expect(r2.revision).toBe(3);

    // recovery_required can also abandon to failed
    runRepo.transitionRun("run-recovery", "implementing", "recovery_required");
    const r3 = runRepo.transitionRun(
      "run-recovery",
      "recovery_required",
      "failed",
    );
    expect(r3.status).toBe("failed");
    expect(r3.revision).toBe(5);
    expect(r3.finishedAt).not.toBeNull();
  });

  it("rejects illegal transitions with IllegalStateTransitionError", () => {
    createTestRun("run-illegal", "preparing");

    // preparing -> reviewing is illegal
    expect(() => {
      runRepo.transitionRun("run-illegal", "preparing", "reviewing");
    }).toThrow(IllegalStateTransitionError);

    // current state must still be preparing
    const current = runRepo.get("run-illegal");
    expect(current?.status).toBe("preparing");
    expect(current?.revision).toBe(1);
  });

  it("rejects transition when actual state does not match fromState", () => {
    createTestRun("run-mismatch", "preparing");

    // Caller thinks it is queued, but it's actually preparing
    expect(() => {
      runRepo.transitionRun("run-mismatch", "queued", "preparing");
    }).toThrow(IllegalStateTransitionError);
  });

  it("rejects stale updates with StaleRevisionError when expectedRevision does not match", () => {
    createTestRun("run-stale", "preparing");

    // Update with expectedRevision = 99 (actual is 1)
    expect(() => {
      runRepo.transitionRun("run-stale", "preparing", "understanding", {
        expectedRevision: 99,
      });
    }).toThrow(StaleRevisionError);

    // update() method also enforces StaleRevisionError
    expect(() => {
      runRepo.update("run-stale", {
        status: "understanding",
        expectedRevision: 99,
      });
    }).toThrow(StaleRevisionError);
  });

  it("throws RunNotFoundError for non-existent runs", () => {
    expect(() => {
      runRepo.transitionRun("non-existent-run", "queued", "preparing");
    }).toThrow(RunNotFoundError);
  });

  it("prevents race condition when two concurrent transitions collide", () => {
    createTestRun("run-race", "implementing");

    // Worker A reads revision 1
    const revWorkerA = 1;
    // Worker B reads revision 1
    const revWorkerB = 1;

    // Worker A transitions first
    const rA = runRepo.transitionRun("run-race", "implementing", "verifying", {
      expectedRevision: revWorkerA,
    });
    expect(rA.status).toBe("verifying");
    expect(rA.revision).toBe(2);

    // Worker B attempts transition with stale revision 1
    expect(() => {
      runRepo.transitionRun("run-race", "implementing", "failed", {
        expectedRevision: revWorkerB,
      });
    }).toThrow();

    // Final state remains verifying
    const finalRun = runRepo.get("run-race");
    expect(finalRun?.status).toBe("verifying");
    expect(finalRun?.revision).toBe(2);
  });

  it("atomically records durable event alongside state transition (XFM-14)", () => {
    createTestRun("run-events", "preparing");

    const updated = runRepo.transitionRun(
      "run-events",
      "preparing",
      "understanding",
      {
        event: {
          type: "status",
          payload: { text: "Transitioned to understanding" },
        },
      },
    );

    expect(updated.status).toBe("understanding");
    expect(updated.revision).toBe(2);

    // Verify durable event was committed in run_events
    const events = eventRepo.getEventsForRun("run-events");
    expect(events.length).toBe(1);
    expect(events[0]?.sequence).toBe(1);
    expect(events[0]?.type).toBe("status");
    expect(events[0]?.payload).toEqual({
      text: "Transitioned to understanding",
    });
  });

  describe("Exhaustive State Transition Matrix (XFM-56)", () => {
    const ALL_STATUSES: RunStatus[] = [
      "queued",
      "preparing",
      "understanding",
      "implementing",
      "verifying",
      "reviewing",
      "ready_for_pr",
      "recovery_required",
      "pr_created",
      "failed",
      "stopped",
    ];

    it("verifies 100% of legal state transitions succeed", () => {
      let legalCount = 0;
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          if (canTransition(from, to)) {
            const runId = `matrix-legal-${from}-to-${to}`;
            createTestRun(runId, from);
            const res = runRepo.transitionRun(runId, from, to);
            expect(res.status).toBe(to);
            expect(res.revision).toBe(2);
            legalCount++;
          }
        }
      }
      expect(legalCount).toBe(34);
    });

    it("verifies every illegal transition is strictly rejected", () => {
      let illegalCount = 0;
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          if (!canTransition(from, to)) {
            const runId = `matrix-illegal-${from}-to-${to}`;
            createTestRun(runId, from);
            expect(() => {
              runRepo.transitionRun(runId, from, to);
            }).toThrow(IllegalStateTransitionError);
            illegalCount++;
          }
        }
      }
      expect(illegalCount).toBe(ALL_STATUSES.length * ALL_STATUSES.length - 34);
    });

    it("enforces that terminal states (pr_created, failed, stopped) reject all transitions", () => {
      const terminalStates: RunStatus[] = ["pr_created", "failed", "stopped"];
      for (const term of terminalStates) {
        for (const target of ALL_STATUSES) {
          const runId = `term-${term}-to-${target}`;
          createTestRun(runId, term);
          expect(() => {
            runRepo.transitionRun(runId, term, target);
          }).toThrow(IllegalStateTransitionError);
        }
      }
    });
  });
});
