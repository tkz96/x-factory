// src/agents/pi.ts — Decoupled Pi coding agent SDK adapter for implementation and read-only review.

import {
  type AgentSession,
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface SessionOptions {
  provider?: string | undefined;
  model?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
}

type PiEventListener = (event: {
  type: "text" | "tool" | "done" | "error";
  text?: string | undefined;
  tool?: string | undefined;
  input?: string | undefined;
  error?: string | undefined;
}) => void;

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

function notifyListeners(
  listeners: Set<PiEventListener>,
  payload: PiEventPayload,
): void {
  for (const l of listeners) {
    l(payload);
  }
}

function translateSessionEvent(event: {
  type?: string;
  [key: string]: unknown;
}): PiEventPayload | null {
  if (event.type === "message_update") {
    const msg = (
      event as { assistantMessageEvent?: { type?: string; delta?: string } }
    ).assistantMessageEvent;
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
    const raw = event as {
      messages?: Array<{
        role?: string;
        stopReason?: string;
        errorMessage?: string;
      }>;
    };
    const lastMsg = raw.messages?.[raw.messages.length - 1];
    if (lastMsg?.stopReason === "error" || lastMsg?.errorMessage) {
      return {
        type: "error",
        error:
          lastMsg.errorMessage ||
          `Pi session failed with stopReason: ${lastMsg?.stopReason}`,
      };
    }
    return { type: "done" };
  }
  return null;
}

/**
 * Wrap a raw Pi AgentSession into the decoupled PiAgentSession interface.
 */
function wrapSession(session: AgentSession): PiAgentSession {
  const listeners = new Set<PiEventListener>();
  let lastSessionError: string | null = null;

  session.subscribe((event) => {
    try {
      const payload = translateSessionEvent(event as { type?: string });
      if (payload) {
        if (payload.type === "error" && payload.error) {
          lastSessionError = payload.error;
        }
        notifyListeners(listeners, payload);
      }
    } catch {
      // Prevent listener errors from failing the session
    }
  });

  return {
    session,
    async prompt(text: string): Promise<void> {
      lastSessionError = null;
      try {
        await session.prompt(text);
        if (lastSessionError) {
          throw new Error(lastSessionError);
        }
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

async function resolveSessionModel(options?: SessionOptions) {
  if (!options?.provider || !options?.model) {
    return {
      model: undefined,
      thinkingLevel: options?.thinkingLevel,
      modelRuntime: undefined,
    };
  }
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(options.provider, options.model);
  return {
    model: model || undefined,
    thinkingLevel: options.thinkingLevel,
    modelRuntime,
  };
}

async function createConfiguredSession(
  worktreePath: string,
  tools: string[],
  options?: SessionOptions,
): Promise<PiAgentSession> {
  const resolved = await resolveSessionModel(options);
  const sessionConfig: CreateAgentSessionOptions = {
    cwd: worktreePath,
    sessionManager: SessionManager.inMemory(worktreePath),
    tools,
    ...(resolved.model ? { model: resolved.model } : {}),
    ...(resolved.thinkingLevel
      ? { thinkingLevel: resolved.thinkingLevel }
      : {}),
    ...(resolved.modelRuntime ? { modelRuntime: resolved.modelRuntime } : {}),
  };
  const { session } = await createAgentSession(sessionConfig);
  return wrapSession(session);
}

/**
 * Create Pi Implementation Session A.
 * Full tools enabled: read, bash, edit, write.
 */
export async function createImplementationSession(
  worktreePath: string,
  options?: SessionOptions,
): Promise<PiAgentSession> {
  return createConfiguredSession(
    worktreePath,
    ["read", "bash", "edit", "write"],
    options,
  );
}

/**
 * Create Pi Review Session B.
 * Genuinely read-only tools enabled: read, grep, find, ls.
 * Review session cannot modify code or run arbitrary bash.
 */
export async function createReviewSession(
  worktreePath: string,
  options?: SessionOptions,
): Promise<PiAgentSession> {
  return createConfiguredSession(
    worktreePath,
    ["read", "grep", "find", "ls"],
    options,
  );
}

// Active session registry for in-flight Pi sessions (XFM-74)
const activeSessions = new Map<string, PiAgentSession>();

export function registerActiveSession(
  runId: string,
  session: PiAgentSession,
): () => void {
  activeSessions.set(runId, session);
  return () => {
    if (activeSessions.get(runId) === session) {
      activeSessions.delete(runId);
    }
  };
}

export function getActiveSession(runId: string): PiAgentSession | undefined {
  return activeSessions.get(runId);
}
