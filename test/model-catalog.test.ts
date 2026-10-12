// test/model-catalog.test.ts — Check Connection's one real request per API
// type, against a local HTTP server that speaks each provider's model-list
// endpoint (a test fixture, not a product mock) (#277).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import {
  listProviderModels,
  runtimeCatalogDetails,
} from "../src/model-catalog.js";

const GOOD = "good-key";
let server: Server<undefined>;
let base: string;

/** Which failure the fake server should produce next, keyed by API key. */
function failureFor(key: string | null): Response | undefined {
  if (key === "rejected") return new Response("{}", { status: 401 });
  if (key === "forbidden") return new Response("{}", { status: 403 });
  if (key === "limited-header")
    return new Response("{}", {
      status: 429,
      headers: { "retry-after": "40" },
    });
  if (key === "limited-gemini")
    return Response.json(
      {
        error: {
          code: 429,
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "49.58s",
            },
          ],
        },
      },
      { status: 429 },
    );
  if (key === "broken") return new Response("oops", { status: 500 });
  if (key !== GOOD) return new Response("{}", { status: 401 });
  return undefined;
}

const generate = ["generateContent", "countTokens"];
const GEMINI_MIXED_MODELS = [
  { name: "models/gemini-3.8-flash", supportedGenerationMethods: generate },
  { name: "models/gemini-2.5-pro", supportedGenerationMethods: generate },
  {
    name: "models/gemini-2.5-flash-preview-tts",
    supportedGenerationMethods: generate,
  },
  {
    name: "models/gemini-2.5-flash-image",
    supportedGenerationMethods: generate,
  },
  {
    name: "models/gemini-2.0-flash-preview-image-generation",
    supportedGenerationMethods: generate,
  },
  {
    name: "models/gemini-2.5-flash-native-audio-latest",
    supportedGenerationMethods: ["countTokens", "bidiGenerateContent"],
  },
  {
    name: "models/gemini-live-2.5-flash-preview",
    supportedGenerationMethods: ["bidiGenerateContent"],
  },
  { name: "models/lyria-realtime-exp", supportedGenerationMethods: [] },
  {
    name: "models/imagen-4.0-generate-001",
    supportedGenerationMethods: ["predict"],
  },
  {
    name: "models/gemini-embedding-001",
    supportedGenerationMethods: ["embedContent", "countTextTokens"],
  },
];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // OpenAI-compatible (OpenRouter-style metadata included).
      if (url.pathname === "/openai/v1/models") {
        const key =
          req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
        return (
          failureFor(key) ??
          Response.json({
            data: [
              {
                id: "vendor/model-a",
                name: "Model A",
                context_length: 200000,
                pricing: { prompt: "0.000003", completion: "0.000015" },
                top_provider: { max_completion_tokens: 8192 },
              },
              { id: "plain-model" },
            ],
          })
        );
      }
      // Gemini.
      if (url.pathname === "/gemini/v1beta/models") {
        const key = req.headers.get("x-goog-api-key");
        return (
          failureFor(key) ??
          Response.json({
            models: [
              {
                name: "models/gemini-test-flash",
                displayName: "Gemini Test Flash",
                inputTokenLimit: 1048576,
                outputTokenLimit: 65536,
              },
            ],
          })
        );
      }
      // Gemini, as a real key lists it: chat models next to speech, image,
      // live-audio, music and embedding models (seen in a live end-to-end test).
      if (url.pathname === "/gemini-mixed/v1beta/models") {
        return Response.json({ models: GEMINI_MIXED_MODELS });
      }
      // OpenRouter-style list that says what each model outputs.
      if (url.pathname === "/openrouter/v1/models") {
        return Response.json({
          data: [
            {
              id: "vendor/chat",
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
            },
            {
              id: "vendor/image-maker",
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["image"],
              },
            },
            {
              id: "vendor/text-and-image",
              architecture: { output_modalities: ["image", "text"] },
            },
            { id: "vendor/legacy", architecture: { modality: "text->text" } },
            {
              id: "vendor/old-image",
              architecture: { modality: "text->image" },
            },
            { id: "vendor/no-signal" },
          ],
        });
      }
      // Anthropic.
      if (url.pathname === "/anthropic/v1/models") {
        const key = req.headers.get("x-api-key");
        return (
          failureFor(key) ??
          Response.json({
            data: [{ id: "claude-test", display_name: "Claude Test" }],
          })
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("listProviderModels", () => {
  it("lists OpenAI-compatible models with the metadata the endpoint publishes", async () => {
    const result = await listProviderModels({
      apiType: "openai-compatible",
      baseUrl: `${base}/openai/v1`,
      apiKey: GOOD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toEqual([
      {
        id: "vendor/model-a",
        name: "Model A",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputPricePerMTok: 3,
        outputPricePerMTok: 15,
      },
      { id: "plain-model" },
    ]);
  });

  it("lists Gemini models without the models/ prefix", async () => {
    const result = await listProviderModels({
      apiType: "gemini",
      baseUrl: `${base}/gemini/v1beta`,
      apiKey: GOOD,
    });
    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: "gemini-test-flash",
          name: "Gemini Test Flash",
          contextWindow: 1048576,
          maxOutputTokens: 65536,
        },
      ],
    });
  });

  it("lists only the Gemini models that can generate text for a coding agent", async () => {
    const result = await listProviderModels({
      apiType: "gemini",
      baseUrl: `${base}/gemini-mixed/v1beta`,
      apiKey: GOOD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual([
      "gemini-3.8-flash",
      "gemini-2.5-pro",
    ]);
  });

  it("drops OpenAI-compatible models whose listing says they do not output text, and keeps the rest", async () => {
    const result = await listProviderModels({
      apiType: "openai-compatible",
      baseUrl: `${base}/openrouter/v1`,
      apiKey: GOOD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A model the listing says nothing about is kept: no signal, no guess.
    expect(result.models.map((m) => m.id)).toEqual([
      "vendor/chat",
      "vendor/text-and-image",
      "vendor/legacy",
      "vendor/no-signal",
    ]);
  });

  it("lists Anthropic models", async () => {
    const result = await listProviderModels({
      apiType: "anthropic",
      baseUrl: `${base}/anthropic`,
      apiKey: GOOD,
    });
    expect(result).toEqual({
      ok: true,
      models: [{ id: "claude-test", name: "Claude Test" }],
    });
  });

  it("reports a rejected key as key rejected with the status", async () => {
    for (const key of ["rejected", "forbidden"]) {
      const result = await listProviderModels({
        apiType: "gemini",
        baseUrl: `${base}/gemini/v1beta`,
        apiKey: key,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe("key rejected");
      expect(result.error.message).toMatch(/Key rejected \((401|403)\)/);
    }
  });

  it("reports a missing key as key rejected without calling the provider", async () => {
    const result = await listProviderModels({
      apiType: "gemini",
      baseUrl: `${base}/gemini/v1beta`,
      apiKey: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("key rejected");
  });

  it("reports rate limits with the retry delay, from Retry-After or Gemini's error body", async () => {
    const header = await listProviderModels({
      apiType: "openai-compatible",
      baseUrl: `${base}/openai/v1`,
      apiKey: "limited-header",
    });
    expect(header.ok).toBe(false);
    if (header.ok) return;
    expect(header.error.category).toBe("rate limited");
    expect(header.error.retryAfterSeconds).toBe(40);
    expect(header.error.message).toContain("40 s");

    const body = await listProviderModels({
      apiType: "gemini",
      baseUrl: `${base}/gemini/v1beta`,
      apiKey: "limited-gemini",
    });
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error.category).toBe("rate limited");
    expect(body.error.retryAfterSeconds).toBe(50);
  });

  it("reports an unreachable URL", async () => {
    const result = await listProviderModels({
      apiType: "openai-compatible",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: GOOD,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("unreachable");
    expect(result.error.message).toBe("Can't reach this URL");
  });

  it("reports any other failure with its status", async () => {
    const result = await listProviderModels({
      apiType: "anthropic",
      baseUrl: `${base}/anthropic`,
      apiKey: "broken",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("other");
    expect(result.error.status).toBe(500);
  });
});

describe("runtimeCatalogDetails", () => {
  it("knows Gemini models from the agent runtime's catalogue", () => {
    expect(
      runtimeCatalogDetails(
        "gemini",
        "https://generativelanguage.googleapis.com/v1beta",
        "gemini-flash-lite-latest",
      ),
    ).toEqual({
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      inputPricePerMTok: 0.25,
      outputPricePerMTok: 1.5,
    });
  });

  it("uses the OpenRouter catalogue for an OpenRouter base URL", () => {
    const details = runtimeCatalogDetails(
      "openai-compatible",
      "https://openrouter.ai/api/v1",
      "anthropic/claude-3-haiku",
    );
    expect(details?.contextWindow).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown model or gateway", () => {
    expect(
      runtimeCatalogDetails("gemini", "https://x", "no-such-model"),
    ).toBeUndefined();
    expect(
      runtimeCatalogDetails(
        "openai-compatible",
        "http://localhost:3001/v1",
        "x",
      ),
    ).toBeUndefined();
  });
});
