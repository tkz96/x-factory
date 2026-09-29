// test/state-machine.test.ts — State machine transitions, guards, and domain shapes.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { canTransition, TRANSITIONS } from "../src/state-machine.js";
import type { Run, RunStatus } from "../src/types.js";

describe("Workflow State Machine", () => {
  it("allows valid forward workflow transitions", () => {
    assert.ok(canTransition("preparing", "understanding"));
    assert.ok(
      canTransition("understanding", "awaiting_understanding_approval"),
    );
    assert.ok(canTransition("awaiting_understanding_approval", "planning"));
    assert.ok(canTransition("planning", "awaiting_plan_approval"));
    assert.ok(canTransition("awaiting_plan_approval", "executing"));
    assert.ok(canTransition("executing", "awaiting_review"));
    assert.ok(canTransition("awaiting_review", "ready_for_pr"));
    assert.ok(canTransition("ready_for_pr", "pr_created"));
  });

  it("allows bounded repair transition: executing → executing is not possible directly, but through planning", () => {
    assert.ok(canTransition("awaiting_review", "planning"));
  });

  it("allows review gate transitions: awaiting_review → planning, ready_for_pr", () => {
    assert.ok(canTransition("awaiting_review", "planning"));
    assert.ok(canTransition("awaiting_review", "ready_for_pr"));
    assert.ok(canTransition("awaiting_review", "understanding"));
  });

  it("allows failure transitions from active states", () => {
    assert.ok(canTransition("preparing", "failed"));
    assert.ok(canTransition("understanding", "failed"));
    assert.ok(canTransition("planning", "failed"));
    assert.ok(canTransition("executing", "failed"));
    assert.ok(canTransition("awaiting_review", "failed"));
    assert.ok(canTransition("ready_for_pr", "failed"));
  });

  it("allows user stop from active agent states", () => {
    assert.ok(canTransition("understanding", "stopped"));
    assert.ok(canTransition("executing", "stopped"));
  });

  it("blocks invalid skipping transitions", () => {
    assert.ok(!canTransition("preparing", "executing"));
    assert.ok(!canTransition("preparing", "awaiting_review"));
    assert.ok(!canTransition("preparing", "ready_for_pr"));
    assert.ok(!canTransition("understanding", "ready_for_pr"));
    assert.ok(!canTransition("executing", "ready_for_pr"));
    assert.ok(!canTransition("executing", "pr_created"));
    assert.ok(!canTransition("awaiting_review", "executing"));
  });

  it("blocks transitions from terminal states", () => {
    assert.ok(!canTransition("pr_created", "failed"));
    assert.ok(!canTransition("failed", "executing"));
    assert.ok(!canTransition("stopped", "executing"));
    assert.deepEqual(TRANSITIONS.pr_created, []);
    assert.deepEqual(TRANSITIONS.failed, []);
    assert.deepEqual(TRANSITIONS.stopped, []);
  });

  it("returns false for unknown states", () => {
    assert.ok(!canTransition("unknown_state" as RunStatus, "executing"));
    assert.ok(!canTransition("preparing", "unknown_state" as RunStatus));
  });
});

describe("Run Object Shape", () => {
  it("conforms to the full domain model", () => {
    const run: Run = {
      id: "abc12345",
      project: { id: "test-app", name: "Test App" },
      ticket: {
        id: "PROJ-101",
        title: "Test Feature",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
      },
      plan: "1. Do work\n2. Verify",
      branch: "xfactory/PROJ-101-abc12345",
      status: "preparing",
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
      artifactsDir: "/data/runs/abc12345",
      worktreePath: "/data/worktrees/abc12345",
    };

    assert.equal(run.id, "abc12345");
    assert.equal(run.status, "preparing");
    assert.equal(run.ticket.acceptanceCriteria.length, 2);
    assert.equal(run.repairAttempts, 0);
    assert.ok(run.artifactsDir);
    assert.ok(run.worktreePath);
  });

  it("generates clean automated branch names with generateBranchName", async () => {
    const { generateBranchName } = await import("../src/runs.js");
    const b1 = generateBranchName("GH-42", "Add login page", "a1b2c3d4");
    assert.equal(b1, "factory/gh-42-add-login-page-a1b2c3d4");

    const b2 = generateBranchName(
      "JIRA-99",
      "Fix & Polish CSS layout!",
      "e5f6g7h8",
    );
    assert.equal(b2, "factory/jira-99-fix-polish-css-layout-e5f6g7h8");

    const b3 = generateBranchName("TASK-1");
    assert.equal(b3, "factory/task-1");
  });
});
