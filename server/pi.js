// server/pi.js — Thin wrapper around the Pi coding agent SDK.

import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * Start a Pi agent session.
 *
 * @param {string} cwd        — Working directory (the run worktree).
 * @param {string} prompt     — The fully-assembled implementation prompt.
 * @param {(event: object) => void} onEvent — Callback for X-Factory events.
 * @returns {{ session, done: Promise<void> }}
 */
export async function startSession(cwd, prompt, onEvent) {
  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(),
  });

  // Subscribe to Pi events and map them to simple X-Factory events.
  session.subscribe((event) => {
    try {
      if (event.type === "message_update") {
        const msg = event.assistantMessageEvent;
        if (msg?.type === "text_delta") {
          onEvent({ type: "pi_text", text: msg.delta, timestamp: Date.now() });
        }
      } else if (event.type === "tool_use") {
        onEvent({
          type: "pi_tool",
          tool: event.name || event.tool || "unknown",
          input: summarizeToolInput(event),
          timestamp: Date.now(),
        });
      } else if (event.type === "agent_end") {
        onEvent({ type: "pi_done", timestamp: Date.now() });
      }
    } catch {
      // Don't let event-handling errors kill the session.
    }
  });

  // Send the implementation prompt and wait for Pi to finish.
  const done = session.prompt(prompt).catch((err) => {
    onEvent({ type: "pi_error", error: err.message, timestamp: Date.now() });
    throw err;
  });

  return { session, done };
}

/** Steer a running Pi session. */
export async function steer(session, message) {
  await session.steer(message);
}

/** Abort a running Pi session. */
export async function stop(session) {
  await session.abort();
}

/**
 * Extract a short human-readable summary from a tool_use event.
 * Keeps event payloads small for the UI.
 */
function summarizeToolInput(event) {
  const input = event.input || event.arguments || {};
  // For file operations, show the path.
  if (input.path || input.file_path) return input.path || input.file_path;
  // For bash, show a truncated command.
  if (input.command) return input.command.slice(0, 120);
  // Fallback.
  return "";
}
