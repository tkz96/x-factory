// test/pi-runtime.test.ts — Deterministic Pi SDK compatibility test under Bun.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createImplementationSession,
  createReviewSession,
} from "../src/agents/pi.js";

describe("Pi SDK Compatibility under Bun", () => {
  it("creates implementation session with full tools", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-impl-"));
    try {
      const piAgent = await createImplementationSession(tmp);
      assert.ok(piAgent);
      assert.ok(piAgent.session);
      assert.equal(typeof piAgent.prompt, "function");
      assert.equal(typeof piAgent.steer, "function");
      assert.equal(typeof piAgent.abort, "function");
      assert.equal(typeof piAgent.subscribe, "function");

      // Verify active tool names include read, bash, edit, write
      const activeTools = piAgent.session.getActiveToolNames();
      assert.ok(activeTools.includes("read"), "Should have read tool");
      assert.ok(activeTools.includes("bash"), "Should have bash tool");
      assert.ok(activeTools.includes("edit"), "Should have edit tool");
      assert.ok(activeTools.includes("write"), "Should have write tool");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
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
      assert.ok(!activeTools.includes("bash"), "Reviewer must NOT have bash tool");
      assert.ok(!activeTools.includes("edit"), "Reviewer must NOT have edit tool");
      assert.ok(!activeTools.includes("write"), "Reviewer must NOT have write tool");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("subscribes to session events cleanly", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-sub-"));
    try {
      const piAgent = await createImplementationSession(tmp);
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
      const piAgent = await createImplementationSession(tmp, {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        thinkingLevel: "low",
      });
      assert.ok(piAgent);
      assert.equal(piAgent.session.model?.id, "claude-sonnet-4-5");
      assert.equal(piAgent.session.model?.provider, "anthropic");

      const revAgent = await createReviewSession(tmp, {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      });
      assert.ok(revAgent);
      assert.equal(revAgent.session.model?.id, "claude-sonnet-4-5");
      assert.equal(revAgent.session.model?.provider, "anthropic");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
