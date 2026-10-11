// src/model-catalog.ts — What models a connection offers and what X-Factory
// knows about them (#277).
//
// `listProviderModels` makes ONE real request to the provider's model-list
// endpoint for the connection's API type and returns the models, or an error
// in a category the UI can explain ("Key rejected (401)", "Can't reach this
// URL", "Rate limited, try again in 40 s"). `runtimeCatalogDetails` looks a
// model up in the agent runtime's built-in catalogue, the fallback for details
// a provider's list doesn't publish.

import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import type { ModelApiType } from "./model-connections.js";

/** Details X-Factory keeps per model; every field is optional and editable. */
export interface ModelDetails {
  contextWindow?: number | undefined;
  maxOutputTokens?: number | undefined;
  inputPricePerMTok?: number | undefined;
  outputPricePerMTok?: number | undefined;
}

export interface DiscoveredModel extends ModelDetails {
  id: string;
  name?: string | undefined;
}

export type CheckErrorCategory =
  | "key_rejected"
  | "unreachable"
  | "rate_limited"
  | "other";

export interface CheckError {
  category: CheckErrorCategory;
  message: string;
  status?: number | undefined;
  retryAfterSeconds?: number | undefined;
}

export type ModelListResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: CheckError };

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

function parseModels(apiType: ModelApiType, body: unknown): DiscoveredModel[] {
  const record = (body ?? {}) as Record<string, unknown>;
  if (apiType === "gemini") {
    const models = Array.isArray(record.models) ? record.models : [];
    return models.map((m: Record<string, unknown>) =>
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
  return data.map((m: Record<string, unknown>) => {
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
    if (typeof delay === "string" && /^[\d.]+s$/.test(delay)) {
      return Math.ceil(Number(delay.slice(0, -1)));
    }
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
      error: { category: "key_rejected", message: "No API key is set" },
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
        category: "key_rejected",
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
        category: "rate_limited" as const,
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
