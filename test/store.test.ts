// test/store.test.ts — RunStore persistence and RunEventBus mechanics.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunStore, type InternalRun } from "../src/store.js";
import { RunEventBus } from "../src/events.js";
import type { RunEvent } from "../src/types.js";
import { validateProject } from "../src/config.js";

describe("RunEventBus", () => {
  it("subscribes and receives emitted events", () => {
    const bus = new RunEventBus();
    const received: RunEvent[] = [];

    const unsubscribe = bus.subscribe("run-1", (event) => {
      received.push(event);
    });

    bus.emit("run-1", { type: "info", text: "Hello" });
    bus.emit("run-2", { type: "info", text: "Ignore me" });

    assert.equal(received.length, 1);
    assert.equal(received[0].type, "info");
    assert.equal((received[0] as { text: string }).text, "Hello");

    unsubscribe();
    bus.emit("run-1", { type: "info", text: "Should not receive" });
    assert.equal(received.length, 1);
  });

  it("emits stage evidence correctly", () => {
    const bus = new RunEventBus();
    let evidenceEvent: RunEvent | null = null;

    bus.subscribe("run-1", (event) => {
      if (event.type === "stage_evidence") {
        evidenceEvent = event;
      }
    });

    bus.emitStageEvidence("run-1", "implement", "Implemented cleanly");
    assert.ok(evidenceEvent);
    assert.equal((evidenceEvent as { stage: string }).stage, "implement");
  });
});

describe("RunStore", () => {
  it("stores, retrieves, and summarizes internal runs", () => {
    const store = new RunStore();
    const mockProject = validateProject({
      id: "test-proj",
      name: "Test Project",
      repositoryPath: "/tmp/repo",
      defaultBranch: "main",
      testCommand: "bun test",
    });

    const internalRun: InternalRun = {
      id: "run-test-1",
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Task 1", acceptanceCriteria: ["Done"] },
      plan: "Do it",
      branch: "xfactory/T-1-12345",
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
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktree",
      _session: null,
      _baseline: null,
      _project: mockProject,
    };

    store.set("run-test-1", internalRun);
    assert.equal(store.has("run-test-1"), true);
    assert.equal(store.get("run-test-1")?.id, "run-test-1");

    const summarized = store.summarize(internalRun);
    assert.equal("id" in summarized, true);
    assert.equal("_session" in (summarized as unknown as Record<string, unknown>), false);
    assert.equal("_baseline" in (summarized as unknown as Record<string, unknown>), false);
    assert.equal("_project" in (summarized as unknown as Record<string, unknown>), false);

    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "run-test-1");
  });

  it("persists run.json to artifacts directory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "xfactory-store-test-"));
    try {
      const store = new RunStore();
      const mockProject = validateProject({
        id: "test-proj",
        name: "Test Project",
        repositoryPath: "/tmp/repo",
        defaultBranch: "main",
        testCommand: "bun test",
      });

      const internalRun: InternalRun = {
        id: "run-persist-1",
        project: { id: "test-proj", name: "Test Project" },
        ticket: { id: "T-2", title: "Task 2", acceptanceCriteria: [] },
        plan: "Plan",
        branch: "xfactory/T-2-abc",
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
        artifactsDir: tmpDir,
        worktreePath: tmpDir,
        _session: null,
        _baseline: null,
        _project: mockProject,
      };

      await store.persistRun(internalRun);

      const manifestFile = Bun.file(path.join(tmpDir, "run.json"));
      assert.equal(await manifestFile.exists(), true);
      const data = await manifestFile.json();
      assert.equal(data.id, "run-persist-1");
      assert.equal(data.status, "preparing");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("hydrates runs from project manifests", async () => {
    const store = new RunStore();
    await store.hydrate([]);
    assert.equal(store.list().length, 0);
  });

  it("guards and performs valid state transitions with store.transition", async () => {
    const store = new RunStore();
    const mockProject = validateProject({
      id: "test-proj",
      name: "Test Project",
      repositoryPath: "/tmp/repo",
      defaultBranch: "main",
      testCommand: "bun test",
    });

    const internalRun: InternalRun = {
      id: "run-trans-1",
      project: { id: "test-proj", name: "Test Project" },
      ticket: { id: "T-1", title: "Task 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "xfactory/T-1",
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
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktree",
      _session: null,
      _baseline: null,
      _project: mockProject,
    };

    // Valid forward transition: preparing -> understanding
    const valid = store.transition(internalRun, "understanding");
    assert.equal(valid, true);
    assert.equal(internalRun.status, "understanding");

    // Invalid skipping transition: understanding -> pr_created
    const invalid = store.transition(internalRun, "pr_created");
    assert.equal(invalid, false);
    assert.equal(internalRun.status, "understanding");
  });

  it("initializes run artifacts on disk with initializeArtifacts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "xfactory-artifacts-test-"));
    try {
      const store = new RunStore();
      await store.initializeArtifacts(tmpDir, {
        id: "T-100",
        title: "Test Ticket",
        description: "Test details",
        acceptanceCriteria: ["Must pass all tests"],
      }, "# Implementation Plan\nSteps to take");

      const ticketFile = Bun.file(path.join(tmpDir, "ticket.md"));
      const planFile = Bun.file(path.join(tmpDir, "plan.md"));

      assert.equal(await ticketFile.exists(), true);
      assert.equal(await planFile.exists(), true);

      const ticketText = await ticketFile.text();
      assert.ok(ticketText.includes("# Ticket T-100: Test Ticket"));
      assert.ok(ticketText.includes("Must pass all tests"));

      const planText = await planFile.text();
      assert.ok(planText.includes("# Implementation Plan"));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
