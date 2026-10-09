// test/pi-runtime.test.ts — Deterministic Pi SDK compatibility test under Bun.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pi from "../src/agents/pi.js";
import { createReviewSession } from "../src/agents/pi.js";

describe("Pi SDK Compatibility under Bun", () => {
  it("does not expose the removed steering-era API (#167)", async () => {
    // Steering was removed with #167: the implementation session factory and
    // the Pi session registry are gone from the module's public surface.
    assert.equal("createImplementationSession" in pi, false);
    assert.equal("registerActiveSession" in pi, false);
    assert.equal("getActiveSession" in pi, false);
  });

  it("creates review session with strictly read-only tools", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-rev-"));
    try {
      const piAgent = await createReviewSession(tmp);
      assert.ok(piAgent);
      assert.ok(piAgent.session);

      // Verify read-only tool names
      const activeTools = piAgent.session.getActiveToolNames();
      assert.ok(activeTools.includes("read"), "Reviewer should have read tool");
      assert.ok(activeTools.includes("grep"), "Reviewer should have grep tool");
      assert.ok(activeTools.includes("find"), "Reviewer should have find tool");
      assert.ok(activeTools.includes("ls"), "Reviewer should have ls tool");

      // Verify bash and mutation tools are NOT available
      assert.ok(
        !activeTools.includes("bash"),
        "Reviewer must NOT have bash tool",
      );
      assert.ok(
        !activeTools.includes("edit"),
        "Reviewer must NOT have edit tool",
      );
      assert.ok(
        !activeTools.includes("write"),
        "Reviewer must NOT have write tool",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("subscribes to session events cleanly", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-sub-"));
    try {
      const piAgent = await createReviewSession(tmp);
      const events: string[] = [];
      const unsub = piAgent.subscribe((e) => {
        events.push(e.type);
      });
      assert.equal(typeof unsub, "function");
      unsub();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("applies provider and model options to sessions", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-model-"));
    try {
      const revAgent = await createReviewSession(tmp, {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        thinkingLevel: "low",
      });
      assert.ok(revAgent);
      assert.ok(revAgent.session);
      assert.equal(revAgent.session.model?.id, "claude-sonnet-4-5");
      assert.equal(revAgent.session.model?.provider, "anthropic");
      // The session steer method was removed with steering (#167).
      assert.equal("steer" in revAgent, false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
