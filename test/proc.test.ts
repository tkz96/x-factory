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

  it("sanitizes environment when envPolicy is sanitized", async () => {
    process.env.TEST_WORKER_SECRET_TOKEN = "secret-token-12345";
    try {
      const res = await execCommand(
        "node",
        [
          "-e",
          "console.log(JSON.stringify({ hasSecret: 'TEST_WORKER_SECRET_TOKEN' in process.env, hasPath: 'PATH' in process.env }))",
        ],
        { envPolicy: "sanitized" },
      );
      assert.equal(res.exitCode, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.hasSecret, false);
      assert.equal(parsed.hasPath, true);
    } finally {
      delete process.env.TEST_WORKER_SECRET_TOKEN;
    }
  });

  it("streams output chunks via onOutputChunk callback", async () => {
    const chunks: string[] = [];
    const res = await execCommand(
      "node",
      [
        "-e",
        "process.stdout.write('first chunk\\n'); setTimeout(() => { process.stdout.write('second chunk\\n'); }, 50);",
      ],
      {
        onOutputChunk: (chunk) => {
          chunks.push(chunk);
        },
      },
    );
    assert.equal(res.exitCode, 0);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.join("").includes("first chunk\n"));
    assert.ok(chunks.join("").includes("second chunk\n"));
  });

  it("aborting kills the command and its child processes including grandchildren", async () => {
    const controller = new AbortController();
    const pidFile = `/tmp/grandchild-abort-${Date.now()}.pid`;

    const runPromise = execCommand(
      "sh",
      ["-c", `sh -c 'sleep 60' & echo $! > "${pidFile}"; wait`],
      { signal: controller.signal },
    );

    // Wait until the grandchild pid is written
    let grandchildPid = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const text = await Bun.file(pidFile).text();
        const pid = parseInt(text.trim(), 10);
        if (pid > 0) {
          grandchildPid = pid;
          break;
        }
      } catch {
        // file not yet written
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(grandchildPid > 0, "Expected grandchild pid to be written");

    // Abort the execution
    controller.abort();
    const res = await runPromise;

    assert.equal(res.passed, false);
    assert.ok(res.stderr.includes("Command aborted"));

    // Verify grandchild is gone
    let alive = true;
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    assert.equal(
      alive,
      false,
      "Grandchild process should be killed when command is aborted",
    );

    try {
      await Bun.file(pidFile).delete();
    } catch {
      // ignore cleanup error
    }
  });

  it("a timeout kills the whole process group including grandchildren", async () => {
    const pidFile = `/tmp/grandchild-timeout-${Date.now()}.pid`;

    const res = await execCommand(
      "sh",
      ["-c", `sh -c 'sleep 60' & echo $! > "${pidFile}"; wait`],
      { timeoutMs: 300 },
    );

    assert.equal(res.exitCode, 124);
    assert.equal(res.passed, false);
    assert.ok(res.stderr.includes("timed out after 300ms"));

    const text = await Bun.file(pidFile).text();
    const grandchildPid = parseInt(text.trim(), 10);
    assert.ok(grandchildPid > 0, "Expected grandchild pid to be written");

    // Verify grandchild is gone
    let alive = true;
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    assert.equal(
      alive,
      false,
      "Grandchild process should be killed when command times out",
    );

    try {
      await Bun.file(pidFile).delete();
    } catch {
      // ignore cleanup error
    }
  });
});
