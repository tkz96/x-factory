// test/helpers/scripted-review-session.ts — Scripted review session for tests at the reviewRun seam.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiAgentSession } from "../../src/agents/pi.js";

export interface ScriptedReviewSession extends PiAgentSession {
  readonly disposeCalls: number;
  readonly abortCalls: number;
  readonly prompts: string[];
}

export interface ScriptOptions {
  /** Throw this from prompt() after emitting the output. */
  promptError?: Error;
  /** prompt() stays pending until abort() is called, then rejects. */
  hangUntilAborted?: boolean;
  /** Called when prompt() starts, so a test can abort mid-flight. */
  onPrompt?: () => void;
}

export function scriptedReviewSession(
  output: string,
  options: ScriptOptions = {},
): ScriptedReviewSession {
  const listeners: Array<Parameters<PiAgentSession["subscribe"]>[0]> = [];
  let rejectPrompt: ((err: Error) => void) | undefined;
  const state = { disposeCalls: 0, abortCalls: 0 };
  const prompts: string[] = [];
  return {
    session: {} as unknown as AgentSession,
    prompt: async (text: string) => {
      prompts.push(text);
      options.onPrompt?.();
      if (options.hangUntilAborted) {
        await new Promise<never>((_, reject) => {
          rejectPrompt = reject;
        });
      }
      if (output)
        for (const cb of listeners) cb({ type: "text", text: output });
      if (options.promptError) throw options.promptError;
    },
    steer: async () => {},
    abort: async () => {
      state.abortCalls++;
      rejectPrompt?.(new Error("session aborted"));
    },
    dispose: () => {
      state.disposeCalls++;
    },
    subscribe: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    get disposeCalls() {
      return state.disposeCalls;
    },
    prompts,
    get abortCalls() {
      return state.abortCalls;
    },
  };
}

/** A temp directory factory for run artifacts; call cleanup() from afterAll. */
export function tempArtifactsDirs(): {
  make: () => string;
  cleanup: () => void;
} {
  const dirs: string[] = [];
  return {
    make: () => {
      const dir = mkdtempSync(path.join(tmpdir(), "xf-artifacts-"));
      dirs.push(dir);
      return dir;
    },
    cleanup: () => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const PASSING_REVIEW_OUTPUT =
  "CRITERIA_CHECK:\n- [PASS] Acceptance\n\nFINDINGS:\n- [INFO] Clean implementation\n\nVERDICT:\nPASSED - LGTM!\n";

export const FAILING_REVIEW_OUTPUT =
  "CRITERIA_CHECK:\n- [FAIL] Security\n\nFINDINGS:\n- [ERROR] Security concern found\n\nVERDICT:\nFAILED - Security concern found\n";
