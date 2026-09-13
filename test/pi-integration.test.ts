// test/pi-integration.test.ts — Optional live Pi LLM integration test (gated by XF_TEST_PI=1).

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createImplementationSession } from "../src/agents/pi.js";

const shouldRunLive = process.env.XF_TEST_PI === "1";

describe("Live Pi Integration (Gated)", () => {
  it("runs prompt and captures events when XF_TEST_PI=1", async () => {
    if (!shouldRunLive) {
      // Skipped in standard deterministic runs
      assert.ok(true, "Skipped live Pi test because XF_TEST_PI!=1");
      return;
    }

    const tmp = await mkdtemp(path.join(tmpdir(), "xf-pi-live-"));
    try {
      const pi = await createImplementationSession(tmp);
      let receivedText = false;

      pi.subscribe((e) => {
        if (e.type === "text") receivedText = true;
      });

      await pi.prompt("Respond with exactly: HELLO_X_FACTORY");
      assert.ok(receivedText, "Should have received text delta event");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
