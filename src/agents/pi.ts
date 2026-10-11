// src/agents/pi.ts — Decoupled Pi coding agent SDK adapter for read-only review.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AgentSession,
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  gatewayKeyFor,
  isRateLimitMessage,
  type ModelGateway,
  modelGateway,
  parseRetryDelayMs,
  RateLimitedError,
} from "../model-gateway.js";
import { ModelUnavailableError, type ResolvedModel } from "../model-roles.js";
import { getPiAgentDir, getRunPiAgentDir } from "../paths.js";
import type { ModelApiType } from "../shared/model-connection-types.js";

type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface SessionOptions {
  /** The role's model, connection and key (#278). Required: there is no fallback model. */
  resolved: ResolvedModel;
  thinkingLevel?: ThinkingLevel | undefined;
}

/** The one provider X-Factory registers with the agent runtime (#278). */
export const XFACTORY_PROVIDER_ID = "xfactory";

const PI_API_FOR_TYPE: Readonly<Record<ModelApiType, string>> = {
  gemini: "google-generative-ai",
  anthropic: "anthropic-messages",
  "openai-compatible": "openai-completions",
};

/** Pi reads `$NAME` in a config value as an env reference; `$$` is a literal `$`. */
function literalConfigValue(value: string): string {
  return value.replaceAll("$", "$$$$");
}

/** The role's connection as one Pi provider holding exactly the role's model. */
function providerConfig(resolved: ResolvedModel, apiKey: string) {
  const { details } = resolved;
  return {
    name: `X-Factory: ${resolved.connectionName}`,
    baseUrl: resolved.baseUrl,
    api: PI_API_FOR_TYPE[resolved.apiType],
    apiKey,
    models: [
      {
        id: resolved.modelId,
        name: resolved.modelId,
        reasoning: details.reasoning ?? false,
        input: ["text" as const],
        cost: {
          input: details.inputPricePerMTok ?? 0,
          output: details.outputPricePerMTok ?? 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: details.contextWindow ?? 128_000,
        maxTokens: details.maxOutputTokens ?? 16_384,
      },
    ],
  };
}

/**
 * A model runtime that knows only the role's model, reading nothing from the
 * user's ~/.pi (no models.json; auth kept in X-Factory's own Pi dir).
 */
async function isolatedRuntime(resolved: ResolvedModel) {
  const agentDir = getPiAgentDir();
  await mkdir(agentDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    authPath: path.join(agentDir, "auth.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  modelRuntime.registerProvider(
    XFACTORY_PROVIDER_ID,
    providerConfig(
      resolved,
      literalConfigValue(resolved.apiKey),
    ) as unknown as Parameters<ModelRuntime["registerProvider"]>[1],
  );
  const model = modelRuntime.getModel(XFACTORY_PROVIDER_ID, resolved.modelId);
  if (!model) {
    throw new ModelUnavailableError(
      `Model "${resolved.modelId}" on "${resolved.connectionName}" could not be set up.`,
    );
  }
  return { modelRuntime, model, agentDir };
}

const KEY_REJECTED =
  /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|api key not valid|permission denied|incorrect api key/i;

/** A model error as X-Factory reports it: a rejected key is never retried as something else. */
export function classifyModelError(message: string): Error {
  if (isRateLimitMessage(message)) {
    // The gateway waits and retries these (#280).
    return new RateLimitedError(message, parseRetryDelayMs(message));
  }
  return KEY_REJECTED.test(message)
    ? new ModelUnavailableError(`Key rejected: ${message}`, "key rejected")
    : new Error(message);
}

/**
 * Writes the coding subprocess's own agent config for one run (#278): a
 * models.json naming only the role's model, with the key as an env reference
 * so no secret is written to disk. Returns the env and CLI args to use.
 */
export async function writeRunAgentConfig(
  runDir: string,
  resolved: ResolvedModel,
): Promise<{
  agentDir: string;
  env: Record<string, string>;
  provider: string;
  model: string;
}> {
  const agentDir = getRunPiAgentDir(runDir);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          [XFACTORY_PROVIDER_ID]: providerConfig(resolved, "$XF_MODEL_API_KEY"),
        },
      },
      null,
      2,
    ),
    { encoding: "utf-8", mode: 0o600 },
  );
  return {
    agentDir,
    env: {
      PI_CODING_AGENT_DIR: agentDir,
      XF_MODEL_API_KEY: resolved.apiKey,
      PI_OFFLINE: "1",
    },
    provider: XFACTORY_PROVIDER_ID,
    model: resolved.modelId,
  };
}

type PiEventListener = (event: {
  type: "text" | "tool" | "done" | "error";
  text?: string | undefined;
  tool?: string | undefined;
  input?: string | undefined;
  error?: string | undefined;
}) => void;

/** Tokens and cost a provider reported (#279). */
export interface PiUsage {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  costUsd?: number | undefined;
}

/** Usage from a Pi assistant message's `usage`, if it has one. */
function usageOf(message: unknown): PiUsage | undefined {
  const usage = (
    message as {
      usage?: { input?: number; output?: number; cost?: { total?: number } };
    }
  )?.usage;
  if (!usage) return undefined;
  const result: PiUsage = {};
  if (typeof usage.input === "number") result.tokensIn = usage.input;
  if (typeof usage.output === "number") result.tokensOut = usage.output;
  if (typeof usage.cost?.total === "number" && usage.cost.total > 0) {
    result.costUsd = usage.cost.total;
  }
  return result;
}

function addUsage(total: PiUsage, more: PiUsage | undefined): PiUsage {
  if (!more) return total;
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    tokensIn: sum(total.tokensIn, more.tokensIn),
    tokensOut: sum(total.tokensOut, more.tokensOut),
    costUsd: sum(total.costUsd, more.costUsd),
  };
}

export interface PiAgentSession {
  readonly session: AgentSession;
  /** Tokens and cost reported so far in this session (#279). */
  usage?(): PiUsage;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  /** Release the underlying session. Safe to call once the session is no longer needed. */
  dispose(): void;
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
  let usage: PiUsage = {};

  session.subscribe((event) => {
    try {
      if ((event as { type?: string }).type === "agent_end") {
        const messages =
          (event as { messages?: Array<{ role?: string }> }).messages ?? [];
        for (const message of messages) {
          if (message.role === "assistant")
            usage = addUsage(usage, usageOf(message));
        }
      }
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
    usage: () => usage,
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
    async abort(): Promise<void> {
      await session.abort();
    },
    dispose(): void {
      listeners.clear();
      session.dispose();
    },
    subscribe(listener: PiEventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function createConfiguredSession(
  worktreePath: string,
  tools: string[],
  options: SessionOptions,
): Promise<PiAgentSession> {
  const { modelRuntime, model, agentDir } = await isolatedRuntime(
    options.resolved,
  );
  const sessionConfig: CreateAgentSessionOptions = {
    cwd: worktreePath,
    agentDir,
    sessionManager: SessionManager.inMemory(worktreePath),
    tools,
    model,
    modelRuntime,
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
  };
  const { session } = await createAgentSession(sessionConfig);
  return wrapSession(session);
}

/**
 * A fresh session with read-only repository tools: read, grep, find, ls. Review,
 * Understand and Plan all run on one, so none of them can modify code or run
 * arbitrary bash (#282).
 */
export async function createReadOnlySession(
  worktreePath: string,
  options: SessionOptions,
): Promise<PiAgentSession> {
  return createConfiguredSession(
    worktreePath,
    ["read", "grep", "find", "ls"],
    options,
  );
}

/** How a stage opens the read-only session for its model call; a test seam. */
export type ReadOnlySessionFactory = (
  worktreePath: string,
  options?: SessionOptions,
) => Promise<PiAgentSession>;

/** Dispose must never replace a stage's outcome: Pi's dispose can throw. */
export function disposeQuietly(session: PiAgentSession): void {
  try {
    session.dispose();
  } catch (err: unknown) {
    console.warn(
      "[X-Factory] Failed to dispose the agent session:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content?: string;
  timestamp?: number;
}

/** A rough token count for a context: about four characters per token. */
export function estimateTokens(messages: readonly ChatMessageInput[]): number {
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  return Math.ceil(chars / 4);
}

export interface ChatOptions {
  /** The gateway that paces and queues the call (#280); the worker's by default. */
  gateway?: ModelGateway | undefined;
  /** Told about each rate-limit wait before it happens. */
  onWait?: ((ms: number, reason: string) => void) | undefined;
}

export async function chatWithModel(
  resolved: ResolvedModel,
  messages: ChatMessageInput[],
  options: ChatOptions = {},
): Promise<{ text: string; usage: PiUsage }> {
  // A request larger than the model's window would fail anyway; say why (#280).
  const window = resolved.details.contextWindow;
  const estimated = estimateTokens(messages);
  if (window !== undefined && estimated > window) {
    throw new ModelUnavailableError(
      `Context too large: about ${estimated} tokens for ${resolved.modelId}, whose window is ${window}.`,
      "context too large",
    );
  }
  const { modelRuntime, model } = await isolatedRuntime(resolved);

  let systemPrompt: string | undefined;
  const contextMessages: Record<string, unknown>[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemPrompt =
        (systemPrompt ? `${systemPrompt}\n\n` : "") + (m.content || "");
    } else if (m.role === "user") {
      contextMessages.push({
        role: "user",
        content: m.content || "",
        timestamp: m.timestamp || Date.now(),
      });
    } else if (m.role === "assistant") {
      contextMessages.push({
        role: "assistant",
        content: [{ type: "text", text: String(m.content || "") }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: m.timestamp || Date.now(),
      });
    }
  }

  type ContextPayload = {
    messages: unknown[];
    systemPrompt?: string;
  };

  const context: ContextPayload = {
    messages: contextMessages,
  };
  if (systemPrompt) {
    context.systemPrompt = systemPrompt;
  }

  type SimpleOptionsPayload = {
    reasoning?: "low" | "medium" | "high";
  };
  const simpleOptions: SimpleOptionsPayload = {};
  if (model.reasoning) {
    simpleOptions.reasoning = "low";
  }

  const gateway = options.gateway ?? modelGateway;
  const response = await gateway.run(
    gatewayKeyFor(resolved),
    async () => {
      const reply = await modelRuntime.completeSimple(
        model,
        context as unknown as Parameters<typeof modelRuntime.completeSimple>[1],
        simpleOptions as unknown as Parameters<
          typeof modelRuntime.completeSimple
        >[2],
      );
      if (reply.stopReason === "error") {
        throw classifyModelError(
          reply.errorMessage || "Model request returned error",
        );
      }
      return reply;
    },
    { onWait: options.onWait },
  );

  let text = "";
  if (typeof response.content === "string") {
    text = response.content;
  } else if (Array.isArray(response.content)) {
    type ContentBlock = { type?: string; text?: string };
    text = (response.content as ContentBlock[])
      .filter(
        (b): b is ContentBlock & { text: string } =>
          b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text)
      .join("\n");
  } else if (response.content) {
    text = String(response.content);
  }

  if (!text?.trim()) {
    throw new Error(
      response.errorMessage || "Model returned empty response text",
    );
  }

  return { text: text.trim(), usage: usageOf(response) ?? {} };
}
