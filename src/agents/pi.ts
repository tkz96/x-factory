// src/agents/pi.ts — Decoupled Pi coding agent SDK adapter for implementation and read-only review.

import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

export interface PiEventListener {
  (event: {
    type: "text" | "tool" | "done" | "error";
    text?: string;
    tool?: string;
    input?: string;
    error?: string;
  }): void;
}

export interface PiAgentSession {
  readonly session: AgentSession;
  prompt(text: string): Promise<void>;
  steer(message: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: PiEventListener): () => void;
}

/**
 * Summarize tool inputs to keep event payloads lightweight for UI display.
 */
function summarizeToolInput(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const input = args as Record<string, unknown>;
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return input.command.slice(0, 120);
  if (typeof input.pattern === "string") return input.pattern.slice(0, 80);
  return "";
}

type PiEventPayload = Parameters<PiEventListener>[0];

function notifyListeners(listeners: Set<PiEventListener>, payload: PiEventPayload): void {
  for (const l of listeners) {
    l(payload);
  }
}

function translateSessionEvent(event: { type?: string; [key: string]: unknown }): PiEventPayload | null {
  if (event.type === "message_update") {
    const msg = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
      .assistantMessageEvent;
    if (msg?.type === "text_delta" && typeof msg.delta === "string") {
      return { type: "text", text: msg.delta };
    }
  } else if (event.type === "tool_execution_start") {
    const toolEvent = event as { toolName?: string; args?: unknown };
    return {
      type: "tool",
      tool: toolEvent.toolName || "tool",
      input: summarizeToolInput(toolEvent.args),
    };
  } else if (event.type === "agent_end") {
    return { type: "done" };
  }
  return null;
}

/**
 * Wrap a raw Pi AgentSession into the decoupled PiAgentSession interface.
 */
function wrapSession(session: AgentSession): PiAgentSession {
  const listeners = new Set<PiEventListener>();

  session.subscribe((event) => {
    try {
      const payload = translateSessionEvent(event as { type?: string });
      if (payload) notifyListeners(listeners, payload);
    } catch {
      // Prevent listener errors from failing the session
    }
  });

  return {
    session,
    async prompt(text: string): Promise<void> {
      try {
        await session.prompt(text);
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        notifyListeners(listeners, { type: "error", error });
        throw err;
      }
    },
    async steer(message: string): Promise<void> {
      await session.steer(message);
    },
    async abort(): Promise<void> {
      await session.abort();
    },
    subscribe(listener: PiEventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Create Pi Implementation Session A.
 * Full tools enabled: read, bash, edit, write.
 */
export async function createImplementationSession(worktreePath: string): Promise<PiAgentSession> {
  const { session } = await createAgentSession({
    cwd: worktreePath,
    sessionManager: SessionManager.inMemory(worktreePath),
    tools: ["read", "bash", "edit", "write"],
  });

  return wrapSession(session);
}

/**
 * Create Pi Review Session B.
 * Genuinely read-only tools enabled: read, grep, find, ls.
 * Review session cannot modify code or run arbitrary bash.
 */
export async function createReviewSession(worktreePath: string): Promise<PiAgentSession> {
  const { session } = await createAgentSession({
    cwd: worktreePath,
    sessionManager: SessionManager.inMemory(worktreePath),
    tools: ["read", "grep", "find", "ls"],
  });

  return wrapSession(session);
}
