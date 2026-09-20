// test/store.test.ts — Run artifact initialization and RunEventBus mechanics (XFM-74).

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunEventBus } from "../src/events.js";
import { initializeRunArtifacts } from "../src/store.js";
import type { RunEvent } from "../src/types.js";

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
    assert.equal(received[0]?.type, "info");
    assert.equal((received[0] as { text: string } | undefined)?.text, "Hello");

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

describe("initializeRunArtifacts", () => {
  it("initializes run artifacts on disk (ticket.md and plan.md)", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "xfactory-artifacts-test-"),
    );
    try {
      await initializeRunArtifacts(
        tmpDir,
        {
          id: "T-100",
          title: "Test Ticket",
          description: "Test details",
          acceptanceCriteria: ["Must pass all tests"],
        },
        "# Implementation Plan\nSteps to take",
      );

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
