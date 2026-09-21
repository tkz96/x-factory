// test/store.test.ts — Run artifact initialization tests (XFM-74).

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeRunArtifacts } from "../src/store.js";

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
