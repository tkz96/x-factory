// test/state-machine.test.ts — State machine transitions, guards, and domain shapes.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { canTransition, TRANSITIONS } from "../src/runs.js";
import type { Run, RunStatus } from "../src/types.js";

describe("Workflow State Machine", () => {
  it("allows valid forward workflow transitions", () => {
    assert.ok(canTransition("preparing", "understanding"));
    assert.ok(canTransition("understanding", "implementing"));
    assert.ok(canTransition("implementing", "verifying"));
    assert.ok(canTransition("verifying", "reviewing"));
    assert.ok(canTransition("reviewing", "ready_for_pr"));
    assert.ok(canTransition("ready_for_pr", "pr_created"));
  });

  it("allows bounded repair transition: verifying → implementing", () => {
    assert.ok(canTransition("verifying", "implementing"));
  });

  it("allows failure transitions from active states", () => {
    assert.ok(canTransition("preparing", "failed"));
    assert.ok(canTransition("understanding", "failed"));
    assert.ok(canTransition("implementing", "failed"));
    assert.ok(canTransition("verifying", "failed"));
    assert.ok(canTransition("reviewing", "failed"));
    assert.ok(canTransition("ready_for_pr", "failed"));
  });

  it("allows user stop from active agent states", () => {
    assert.ok(canTransition("understanding", "stopped"));
    assert.ok(canTransition("implementing", "stopped"));
  });

  it("blocks invalid skipping transitions", () => {
    assert.ok(!canTransition("preparing", "implementing"));
    assert.ok(!canTransition("preparing", "verifying"));
    assert.ok(!canTransition("preparing", "ready_for_pr"));
    assert.ok(!canTransition("understanding", "ready_for_pr"));
    assert.ok(!canTransition("implementing", "ready_for_pr"));
    assert.ok(!canTransition("implementing", "pr_created"));
    assert.ok(!canTransition("reviewing", "implementing"));
  });

  it("blocks transitions from terminal states", () => {
    assert.ok(!canTransition("pr_created", "failed"));
    assert.ok(!canTransition("failed", "implementing"));
    assert.ok(!canTransition("stopped", "implementing"));
    assert.deepEqual(TRANSITIONS.pr_created, []);
    assert.deepEqual(TRANSITIONS.failed, []);
    assert.deepEqual(TRANSITIONS.stopped, []);
  });

  it("returns false for unknown states", () => {
    assert.ok(!canTransition("unknown_state" as RunStatus, "implementing"));
    assert.ok(!canTransition("preparing", "unknown_state" as RunStatus));
  });

  it("exports identical state machine from dedicated state-machine module", async () => {
    const directModule = await import("../src/state-machine.js");
    assert.deepEqual(directModule.TRANSITIONS, TRANSITIONS);
    assert.equal(directModule.canTransition("preparing", "understanding"), true);
    assert.equal(directModule.canTransition("preparing", "implementing"), false);
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

    const b2 = generateBranchName("JIRA-99", "Fix & Polish CSS layout!", "e5f6g7h8");
    assert.equal(b2, "factory/jira-99-fix-polish-css-layout-e5f6g7h8");

    const b3 = generateBranchName("TASK-1");
    assert.equal(b3, "factory/task-1");
  });
});
