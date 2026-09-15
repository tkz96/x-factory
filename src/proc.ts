// src/proc.ts — Subprocess execution with timeouts, output caps, and clean process cleanup.

import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxBufferChars?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default
const DEFAULT_MAX_BUFFER_CHARS = 50_000;

function createBufferAccumulator(maxBufferChars: number) {
  let buffer = "";
  return {
    append(chunk: Buffer) {
      if (buffer.length < maxBufferChars) {
        buffer += chunk.toString("utf-8");
        if (buffer.length > maxBufferChars) {
          buffer = `${buffer.slice(0, maxBufferChars)}\n... [output truncated]`;
        }
      }
    },
    value() {
      return buffer;
    },
  };
}

function setupProcessTimeout(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  onTimeout: () => void,
): NodeJS.Timeout {
  return setTimeout(() => {
    onTimeout();
    try {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore errors killing child
        }
      }, 1000);
    } catch {
      // ignore errors killing child
    }
  }, timeoutMs);
}

function buildCloseResult(
  fullCommand: string,
  exitCode: number | null,
  timedOut: boolean,
  timeoutMs: number,
  stdout: string,
  stderr: string,
  durationMs: number,
): CommandResult {
  const code = timedOut ? 124 : (exitCode ?? 1);
  const stderrOutput = timedOut
    ? `${stderr}\nCommand timed out after ${timeoutMs}ms`.trim()
    : stderr.trim();

  return {
    command: fullCommand,
    exitCode: code,
    stdout: stdout.trim(),
    stderr: stderrOutput,
    passed: code === 0,
    durationMs,
  };
}

/**
 * Execute a command safely and return a CommandResult.
 * Always resolves (does not throw on non-zero exit code).
 */
export function execCommand(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): Promise<CommandResult> {
  const {
    cwd,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
  } = options;

  const fullCommand = [cmd, ...args].join(" ");
  const startTime = Date.now();

  return new Promise((resolve) => {
    const stdout = createBufferAccumulator(maxBufferChars);
    const stderr = createBufferAccumulator(maxBufferChars);
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setupProcessTimeout(child, timeoutMs, () => {
      timedOut = true;
    });

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: fullCommand,
        exitCode: 1,
        stdout: stdout.value().trim(),
        stderr:
          `${stderr.value()}\nFailed to spawn command: ${err.message}`.trim(),
        passed: false,
        durationMs: Date.now() - startTime,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(
        buildCloseResult(
          fullCommand,
          code,
          timedOut,
          timeoutMs,
          stdout.value(),
          stderr.value(),
          Date.now() - startTime,
        ),
      );
    });
  });
}

/**
 * Execute a command and reject if the exit code is non-zero or it timed out.
 */
export async function execStrict(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  const result = await execCommand(cmd, args, options);
  if (result.exitCode !== 0) {
    const errorMsg = `${result.command} failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`;
    throw new Error(errorMsg);
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
}
