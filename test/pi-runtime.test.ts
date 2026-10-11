// test/pi-runtime.test.ts — Deterministic Pi SDK compatibility test under Bun.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pi from "../src/agents/pi.js";
import { createReviewSession, XFACTORY_PROVIDER_ID } from "../src/agents/pi.js";
import type { ResolvedModel } from "../src/model-roles.js";

/** A role resolved to a local OpenAI-compatible endpoint; creating a session makes no request. */
const RESOLVED: ResolvedModel = {
  role: "reviewer",
  connectionId: "c1",
  connectionName: "Local",
  apiType: "openai-compatible",
  baseUrl: "http://127.0.0.1:9/v1",
  modelId: "vendor/review-model",
  apiKey: "test-key",
  details: { contextWindow: 32000, maxOutputTokens: 4000 },
};

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
      const piAgent = await createReviewSession(tmp, { resolved: RESOLVED });
      assert.ok(piAgent);
      assert.ok(piAgent.session);
      // The session surface every caller relies on (restored from the deleted
      // implementation-session test, #167).
      assert.equal(typeof piAgent.prompt, "function");
      assert.equal(typeof piAgent.abort, "function");
      assert.equal(typeof piAgent.subscribe, "function");

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
      const piAgent = await createReviewSession(tmp, { resolved: RESOLVED });
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

  it("runs the session on the role's model through X-Factory's own provider (#278)", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-model-"));
    try {
      const revAgent = await createReviewSession(tmp, {
        resolved: RESOLVED,
        thinkingLevel: "low",
      });
      assert.ok(revAgent);
      assert.ok(revAgent.session);
      assert.equal(revAgent.session.model?.id, "vendor/review-model");
      assert.equal(revAgent.session.model?.provider, XFACTORY_PROVIDER_ID);
      assert.equal(revAgent.session.model?.baseUrl, "http://127.0.0.1:9/v1");
      // The session steer method was removed with steering (#167).
      assert.equal("steer" in revAgent, false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
