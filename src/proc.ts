// src/proc.ts — Subprocess execution with timeouts, output caps, AbortSignal, environment policy, and process group cleanup.

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { CommandResult } from "./types.js";

export type EnvPolicy = "inherit" | "sanitized";

export interface ExecOptions {
  cwd?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  timeoutMs?: number | undefined;
  maxBufferChars?: number | undefined;
  /** Keep stdout byte-exact instead of trimming it (for whitespace-significant formats). */
  rawStdout?: boolean | undefined;
  /** Optional AbortSignal to abort the command and kill its process group. */
  signal?: AbortSignal | undefined;
  /** Streaming callback receiving output chunks as they arrive. */
  onOutputChunk?:
    | ((chunk: string, stream: "stdout" | "stderr") => void)
    | undefined;
  /** Alias for onOutputChunk. */
  onChunk?: ((chunk: string, stream: "stdout" | "stderr") => void) | undefined;
  /** Environment policy: 'inherit' (default) copies process.env; 'sanitized' allows only safe standard variables. */
  envPolicy?: EnvPolicy | undefined;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default
const DEFAULT_MAX_BUFFER_CHARS = 50_000;
/** Appended to output that hit `maxBufferChars`. */
export const TRUNCATION_MARKER = "\n... [output truncated]";

export const DEFAULT_ALLOWED_ENV_KEYS: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
];

export function resolveSanitizedEnv(
  providerOrOptions?:
    | string
    | {
        provider?: string | undefined;
        allowedKeys?: readonly string[] | undefined;
        extraKeys?: readonly string[] | undefined;
      },
): Record<string, string> {
  const options =
    typeof providerOrOptions === "string"
      ? { provider: providerOrOptions }
      : providerOrOptions;

  const keys = new Set<string>(
    options?.allowedKeys ?? DEFAULT_ALLOWED_ENV_KEYS,
  );

  if (options?.provider) {
    keys.add("PI_API_KEY");
    if (options.provider === "anthropic") keys.add("ANTHROPIC_API_KEY");
    if (options.provider === "openai") keys.add("OPENAI_API_KEY");
    if (options.provider === "google") keys.add("GEMINI_API_KEY");
  }

  if (options?.extraKeys) {
    for (const key of options.extraKeys) {
      keys.add(key);
    }
  }

  const sanitized: Record<string, string> = {};
  for (const key of keys) {
    const val = process.env[key];
    if (val !== undefined) {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

function createBufferAccumulator(
  maxBufferChars: number,
  onChunk?: (chunk: string) => void,
) {
  // Streaming decoder so a multi-byte character split across chunks stays intact.
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let truncated = false;
  const add = (text: string) => {
    if (text && onChunk) {
      onChunk(text);
    }
    if (truncated) return;
    if (buffer.length + text.length > maxBufferChars) {
      buffer += text.slice(0, maxBufferChars - buffer.length);
      truncated = true;
    } else {
      buffer += text;
    }
  };
  return {
    append(chunk: Buffer) {
      add(decoder.write(chunk));
    },
    value() {
      add(decoder.end());
      return truncated ? `${buffer}${TRUNCATION_MARKER}` : buffer;
    },
  };
}

function killProcessGroup(
  child: ReturnType<typeof spawn>,
  signal: "SIGTERM" | "SIGKILL",
): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // ignore errors if process group has already exited
    }
  }

  try {
    child.kill(signal);
  } catch {
    // ignore errors if child has already exited
  }
}

function buildCloseResult(
  fullCommand: string,
  exitCode: number | null,
  timedOut: boolean,
  timeoutMs: number,
  stdout: string,
  stderr: string,
  durationMs: number,
  aborted = false,
): CommandResult {
  const code = timedOut
    ? 124
    : aborted && (exitCode === 0 || exitCode === null)
      ? 1
      : (exitCode ?? 1);

  let stderrOutput = stderr.trim();
  if (timedOut) {
    stderrOutput =
      `${stderrOutput}\nCommand timed out after ${timeoutMs}ms`.trim();
  } else if (aborted) {
    stderrOutput = `${stderrOutput}\nCommand aborted`.trim();
  }

  return {
    command: fullCommand,
    exitCode: code,
    stdout,
    stderr: stderrOutput,
    passed: code === 0 && !timedOut && !aborted,
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
    rawStdout = false,
    signal,
    envPolicy = "inherit",
    onOutputChunk,
    onChunk,
  } = options;

  const fullCommand = [cmd, ...args].join(" ");
  const startTime = Date.now();

  const emitChunk = onOutputChunk ?? onChunk;

  if (signal?.aborted) {
    return Promise.resolve(
      buildCloseResult(
        fullCommand,
        1,
        false,
        timeoutMs,
        "",
        "Command aborted",
        0,
        true,
      ),
    );
  }

  const baseEnv =
    envPolicy === "sanitized" ? resolveSanitizedEnv() : process.env;
  const resolvedEnv = { ...baseEnv, ...env };

  return new Promise((resolve) => {
    const stdout = createBufferAccumulator(
      maxBufferChars,
      emitChunk ? (chunk) => emitChunk(chunk, "stdout") : undefined,
    );
    const stderr = createBufferAccumulator(
      maxBufferChars,
      emitChunk ? (chunk) => emitChunk(chunk, "stderr") : undefined,
    );
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let escalationTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const child = spawn(cmd, args, {
      cwd,
      env: resolvedEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminate = () => {
      if (settled) return;
      if (escalationTimer) return; // One SIGTERM -> SIGKILL escalation timer

      killProcessGroup(child, "SIGTERM");
      escalationTimer = setTimeout(() => {
        escalationTimer = null;
        killProcessGroup(child, "SIGKILL");
      }, 1000);
    };

    if (timeoutMs > 0 && timeoutMs < Number.POSITIVE_INFINITY) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
    }

    const abortHandler = () => {
      aborted = true;
      terminate();
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (escalationTimer) {
        clearTimeout(escalationTimer);
        escalationTimer = null;
      }
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
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
      cleanup();
      resolve(
        buildCloseResult(
          fullCommand,
          code,
          timedOut,
          timeoutMs,
          rawStdout ? stdout.value() : stdout.value().trim(),
          stderr.value(),
          Date.now() - startTime,
          aborted,
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
