// test/proc.test.ts — Subprocess timeout, buffer truncation, and exit code capture tests.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execCommand, execStrict } from "../src/proc.js";

describe("Subprocess Runner (proc.ts)", () => {
  it("executes successful command and captures stdout", async () => {
    const res = await execCommand("echo", ["hello world"]);
    assert.equal(res.exitCode, 0);
    assert.equal(res.passed, true);
    assert.equal(res.stdout, "hello world");
    assert.ok(res.durationMs >= 0);
  });

  it("captures non-zero exit code and stderr without throwing in execCommand", async () => {
    const res = await execCommand("sh", [
      "-c",
      "echo 'failed output' >&2; exit 42",
    ]);
    assert.equal(res.exitCode, 42);
    assert.equal(res.passed, false);
    assert.equal(res.stderr, "failed output");
  });

  it("enforces timeout and terminates long-running process", async () => {
    const res = await execCommand("sleep", ["5"], { timeoutMs: 300 });
    assert.equal(res.exitCode, 124);
    assert.equal(res.passed, false);
    assert.ok(res.stderr.includes("timed out after 300ms"));
  });

  it("truncates excessive stdout buffer", async () => {
    // Generate 1000 characters
    const res = await execCommand(
      "sh",
      [
        "-c",
        "python3 -c 'print(\"A\" * 500)' 2>/dev/null || node -e 'console.log(\"A\".repeat(500))'",
      ],
      {
        maxBufferChars: 50,
      },
    );
    assert.ok(res.stdout.length <= 100);
    assert.ok(res.stdout.includes("[output truncated]"));
  });

  it("marks truncation when output stops exactly at the cap", async () => {
    const res = await execCommand(
      "sh",
      ["-c", "printf '%050d' 0; sleep 0.2; printf more"],
      { maxBufferChars: 50 },
    );
    assert.ok(res.stdout.endsWith("[output truncated]"));
  });

  it("keeps stdout byte-exact when rawStdout is set", async () => {
    const res = await execCommand("printf", ["  x  "], { rawStdout: true });
    assert.equal(res.stdout, "  x  ");
  });

  it("decodes a multi-byte character split across output chunks", async () => {
    const res = await execCommand("sh", [
      "-c",
      "printf '\\346'; sleep 0.2; printf '\\227\\245'",
    ]);
    assert.equal(res.stdout, "日");
  });

  it("execStrict resolves on success and throws on failure", async () => {
    const res = await execStrict("echo", ["strict test"]);
    assert.equal(res.stdout, "strict test");

    await assert.rejects(
      () => execStrict("sh", ["-c", "exit 1"]),
      /failed \(exit 1\)/,
    );
  });
});
