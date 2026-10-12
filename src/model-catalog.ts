// src/model-catalog.ts — What models a connection offers and what X-Factory
// knows about them (#277).
//
// `listProviderModels` makes ONE real request to the provider's model-list
// endpoint for the connection's API type and returns the models that can run
// a coding agent (text out, by what the listing says), or an error
// in a category the UI can explain ("Key rejected (401)", "Can't reach this
// URL", "Rate limited, try again in 40 s"). `runtimeCatalogDetails` looks a
// model up in the agent runtime's built-in catalogue, the fallback for details
// a provider's list doesn't publish.

import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";

import { parseDurationSeconds } from "./retry-delay.js";
import type {
  DiscoveredModel,
  ModelApiType,
  ModelDetails,
  ModelListResult,
} from "./shared/model-connection-types.js";

interface ListInput {
  apiType: ModelApiType;
  baseUrl: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 15_000;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function request(input: ListInput & { apiKey: string }): {
  url: string;
  headers: Record<string, string>;
} {
  const base = trimSlash(input.baseUrl);
  switch (input.apiType) {
    case "gemini":
      return {
        url: `${base}/models?pageSize=1000`,
        headers: { "x-goog-api-key": input.apiKey },
      };
    case "anthropic":
      return {
        url: `${base}/v1/models?limit=1000`,
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
      };
    case "openai-compatible":
      return {
        url: `${base}/models`,
        headers: { authorization: `Bearer ${input.apiKey}` },
      };
  }
}

function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Drops undefined fields so results compare and serialise cleanly. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Gemini model ids whose output is speech, images or live audio. They answer
 * generateContent, so the method list alone cannot tell them apart; Google's
 * ids name the output (`-tts`, `-image`, `native-audio`), and that is the only
 * signal its model list gives.
 */
const GEMINI_NON_TEXT_OUTPUT = /-tts(-|$)|-image(-|$)|native-audio/;

/**
 * Whether a Gemini model can run a coding agent: it must offer
 * generateContent (when the listing says what it offers) and not be a speech
 * or image model.
 */
function isGeminiTextModel(m: Record<string, unknown>): boolean {
  const id = String(m.name ?? "").replace(/^models\//, "");
  const methods = m.supportedGenerationMethods;
  if (Array.isArray(methods) && !methods.includes("generateContent")) {
    return false;
  }
  return !GEMINI_NON_TEXT_OUTPUT.test(id);
}

/**
 * Whether an OpenAI-compatible model outputs text, by what its listing says:
 * OpenRouter publishes `architecture.output_modalities` (or the older
 * `architecture.modality`, "input->output"). A listing that says nothing, like
 * OpenAI's own, keeps the model: there is no signal to filter on.
 */
function outputsText(m: Record<string, unknown>): boolean {
  const architecture = (m.architecture ?? {}) as Record<string, unknown>;
  const outputs = architecture.output_modalities;
  if (Array.isArray(outputs)) return outputs.includes("text");
  const modality = architecture.modality;
  if (typeof modality === "string" && modality.includes("->")) {
    return modality.split("->")[1]?.split("+").includes("text") ?? true;
  }
  return true;
}

/**
 * Whether an OpenAI-compatible endpoint can serve the model. FreeLLMAPI marks
 * the models it has no upstream key for with `available: false` (and an
 * `unavailable_reason`); a listing without the field keeps the model.
 */
function isAvailable(m: Record<string, unknown>): boolean {
  return m.available !== false;
}

function parseModels(apiType: ModelApiType, body: unknown): DiscoveredModel[] {
  const record = (body ?? {}) as Record<string, unknown>;
  if (apiType === "gemini") {
    const models = Array.isArray(record.models) ? record.models : [];
    return models.filter(isGeminiTextModel).map((m: Record<string, unknown>) =>
      compact({
        id: String(m.name ?? "").replace(/^models\//, ""),
        name: typeof m.displayName === "string" ? m.displayName : undefined,
        contextWindow: positiveNumber(m.inputTokenLimit),
        maxOutputTokens: positiveNumber(m.outputTokenLimit),
      }),
    );
  }
  const data = Array.isArray(record.data) ? record.data : [];
  if (apiType === "anthropic") {
    return data.map((m: Record<string, unknown>) =>
      compact({
        id: String(m.id ?? ""),
        name: typeof m.display_name === "string" ? m.display_name : undefined,
      }),
    );
  }
  return data
    .filter((m: Record<string, unknown>) => isAvailable(m) && outputsText(m))
    .map((m: Record<string, unknown>) => {
      const pricing = (m.pricing ?? {}) as Record<string, unknown>;
      const topProvider = (m.top_provider ?? {}) as Record<string, unknown>;
      const perToken = (v: unknown) => {
        const n = positiveNumber(v);
        // OpenRouter publishes USD per token; X-Factory stores USD per million.
        return n === undefined ? undefined : Math.round(n * 1e6 * 1e6) / 1e6;
      };
      return compact({
        id: String(m.id ?? ""),
        name: typeof m.name === "string" ? m.name : undefined,
        contextWindow: positiveNumber(m.context_length),
        maxOutputTokens: positiveNumber(topProvider.max_completion_tokens),
        inputPricePerMTok: perToken(pricing.prompt),
        outputPricePerMTok: perToken(pricing.completion),
      });
    });
}

/** Seconds to wait from a Retry-After header or a Gemini RetryInfo detail. */
function retryAfterSeconds(res: Response, body: unknown): number | undefined {
  const header = positiveNumber(res.headers.get("retry-after"));
  if (header !== undefined) return Math.ceil(header);
  const details = (body as { error?: { details?: unknown[] } })?.error?.details;
  for (const detail of Array.isArray(details) ? details : []) {
    const delay = (detail as { retryDelay?: unknown }).retryDelay;
    const seconds =
      typeof delay === "string" ? parseDurationSeconds(delay) : undefined;
    if (seconds !== undefined) return Math.ceil(seconds);
  }
  return undefined;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function listProviderModels(
  input: ListInput,
): Promise<ModelListResult> {
  if (!input.apiKey) {
    return {
      ok: false,
      error: { category: "key rejected", message: "No API key is set" },
    };
  }
  const { url, headers } = request({ ...input, apiKey: input.apiKey });
  const fetchFn = input.fetchFn ?? fetch;

  let res: Response;
  try {
    res = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      error: { category: "unreachable", message: "Can't reach this URL" },
    };
  }

  const body = await readJson(res);
  if (res.ok) return { ok: true, models: parseModels(input.apiType, body) };
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: {
        category: "key rejected",
        status: res.status,
        message: `Key rejected (${res.status})`,
      },
    };
  }
  if (res.status === 429) {
    const wait = retryAfterSeconds(res, body);
    return {
      ok: false,
      error: compact({
        category: "rate limited" as const,
        status: 429,
        retryAfterSeconds: wait,
        message:
          wait === undefined
            ? "Rate limited, try again later"
            : `Rate limited, try again in ${wait} s`,
      }),
    };
  }
  return {
    ok: false,
    error: {
      category: "other",
      status: res.status,
      message: `Unexpected response (${res.status})`,
    },
  };
}

type Catalog = Record<
  string,
  {
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    cost?: { input?: number; output?: number };
  }
>;

function catalogFor(
  apiType: ModelApiType,
  baseUrl: string,
): Catalog | undefined {
  if (apiType === "gemini") return GOOGLE_MODELS as unknown as Catalog;
  if (apiType === "anthropic") return ANTHROPIC_MODELS as unknown as Catalog;
  if (baseUrl.includes("openrouter.ai"))
    return OPENROUTER_MODELS as unknown as Catalog;
  if (baseUrl.includes("api.openai.com"))
    return OPENAI_MODELS as unknown as Catalog;
  return undefined;
}

export function runtimeCatalogDetails(
  apiType: ModelApiType,
  baseUrl: string,
  modelId: string,
): ModelDetails | undefined {
  const entry = catalogFor(apiType, baseUrl)?.[modelId];
  if (!entry) return undefined;
  return compact({
    contextWindow: positiveNumber(entry.contextWindow),
    maxOutputTokens: positiveNumber(entry.maxTokens),
    inputPricePerMTok: entry.cost?.input,
    outputPricePerMTok: entry.cost?.output,
  });
}

/** Whether the runtime catalogue marks a model as reasoning (#278); undefined if unknown. */
export function runtimeCatalogReasoning(
  apiType: ModelApiType,
  baseUrl: string,
  modelId: string,
): boolean | undefined {
  return catalogFor(apiType, baseUrl)?.[modelId]?.reasoning;
}
