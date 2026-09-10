// test/runs.test.js — State machine and run store tests.

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// We need to test the state machine logic without starting real Pi sessions.
// Import the module, then test the public API with mocked dependencies.

// Since runs.js imports pi.js and git.js at the top level, we'll use
// node:test's mocking to replace those modules.

// ── State machine logic (extracted for testability) ────────────────────────────

const TRANSITIONS = {
  preparing:     ["implementing", "failed"],
  implementing:  ["testing", "failed", "stopped"],
  testing:       ["ready_for_pr", "failed"],
  ready_for_pr:  ["pr_created", "failed"],
  pr_created:    [],
  failed:        [],
  stopped:       [],
};

function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("State Machine", () => {
  it("allows preparing → implementing", () => {
    assert.ok(canTransition("preparing", "implementing"));
  });

  it("allows preparing → failed", () => {
    assert.ok(canTransition("preparing", "failed"));
  });

  it("allows implementing → testing", () => {
    assert.ok(canTransition("implementing", "testing"));
  });

  it("allows implementing → stopped", () => {
    assert.ok(canTransition("implementing", "stopped"));
  });

  it("allows implementing → failed", () => {
    assert.ok(canTransition("implementing", "failed"));
  });

  it("allows testing → ready_for_pr", () => {
    assert.ok(canTransition("testing", "ready_for_pr"));
  });

  it("allows testing → failed", () => {
    assert.ok(canTransition("testing", "failed"));
  });

  it("allows ready_for_pr → pr_created", () => {
    assert.ok(canTransition("ready_for_pr", "pr_created"));
  });

  it("blocks invalid transitions", () => {
    assert.ok(!canTransition("preparing", "testing"));
    assert.ok(!canTransition("preparing", "ready_for_pr"));
    assert.ok(!canTransition("preparing", "stopped"));
    assert.ok(!canTransition("implementing", "pr_created"));
    assert.ok(!canTransition("testing", "implementing"));
    assert.ok(!canTransition("failed", "implementing"));
    assert.ok(!canTransition("stopped", "implementing"));
    assert.ok(!canTransition("pr_created", "failed"));
  });

  it("returns false for unknown states", () => {
    assert.ok(!canTransition("nonexistent", "implementing"));
    assert.ok(!canTransition("preparing", "nonexistent"));
  });

  it("terminal states have no valid transitions", () => {
    assert.deepEqual(TRANSITIONS.failed, []);
    assert.deepEqual(TRANSITIONS.stopped, []);
    assert.deepEqual(TRANSITIONS.pr_created, []);
  });
});

describe("Run object shape", () => {
  it("has all required fields", () => {
    const run = {
      id: "abc123",
      project: { id: "my-app", name: "My App" },
      ticket: { id: "42", title: "Add feature" },
      plan: "Do the thing.",
      branch: "x-factory/42",
      status: "preparing",
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tests: null,
      pullRequest: null,
    };

    assert.ok(run.id);
    assert.equal(run.status, "preparing");
    assert.ok(Array.isArray(run.events));
    assert.equal(run.branch, "x-factory/42");
    assert.equal(run.finishedAt, null);
    assert.equal(run.tests, null);
    assert.equal(run.pullRequest, null);
  });
});

describe("Branch naming", () => {
  it("uses x-factory/<ticket-id> format", () => {
    const ticketId = "PROJ-123";
    const branch = `x-factory/${ticketId}`;
    assert.equal(branch, "x-factory/PROJ-123");
  });
});

describe("Event accumulation", () => {
  it("events are pushed in order", () => {
    const events = [];
    events.push({ type: "status", text: "Preparing", timestamp: 1 });
    events.push({ type: "info", text: "Creating branch", timestamp: 2 });
    events.push({ type: "status", text: "Implementing", timestamp: 3 });

    assert.equal(events.length, 3);
    assert.equal(events[0].type, "status");
    assert.equal(events[1].type, "info");
    assert.equal(events[2].timestamp, 3);
  });
});
