// test/pi-model-wiring.test.ts — A resolved role reaches the agent runtime as
// one X-Factory-owned provider, never through ~/.pi, and model failures are
// reported as "model unavailable" / "key rejected", never a fallback (#278).
// The provider is a local HTTP server speaking the OpenAI chat-completions
// stream (a test fixture, not a product mock).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "bun";
import {
  chatWithModel,
  writeRunAgentConfig,
  XFACTORY_PROVIDER_ID,
} from "../src/agents/pi.js";
import { ModelGateway } from "../src/model-gateway.js";
import {
  ModelUnavailableError,
  type ResolvedModel,
} from "../src/model-roles.js";

let server: Server<undefined>;
let base: string;
const seenKeys: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      seenKeys.push(auth);
      if (auth !== "Bearer good-key") {
        return Response.json(
          { error: { message: "bad key" } },
          { status: 401 },
        );
      }
      const body = (await req.json()) as { model: string };
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      const stream =
        chunk({ role: "assistant", content: "PONG from " }, null) +
        chunk({ content: body.model }, null) +
        chunk({}, "stop") +
        "data: [DONE]\n\n";
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(() => server.stop(true));

function resolved(apiKey: string): ResolvedModel {
  return {
    role: "builder",
    connectionId: "c1",
    connectionName: "Local gateway",
    apiType: "openai-compatible",
    baseUrl: base,
    modelId: "vendor/test-model",
    apiKey,
    details: { contextWindow: 32000, maxOutputTokens: 4000 },
    limits: {},
    budget: { perDay: {} },
  };
}

describe("chatWithModel through the role's connection", () => {
  it("calls the connection's base URL with its key and returns the reply", async () => {
    const reply = await chatWithModel(resolved("good-key"), [
      { role: "user", content: "ping" },
    ]);
    expect(reply.text).toBe("PONG from vendor/test-model");
    expect(seenKeys.at(-1)).toBe("Bearer good-key");
  });

  it("reports a rejected key as 'key rejected', never falling back", async () => {
    const err = await chatWithModel(resolved("bad-key"), [
      { role: "user", content: "ping" },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("key rejected");
  });
});

describe("chatWithModel through the gateway (#280)", () => {
  let limited: Server<undefined>;
  let requests = 0;

  beforeAll(() => {
    limited = Bun.serve({
      port: 0,
      async fetch(req) {
        requests++;
        if (requests === 1) {
          return Response.json(
            {
              error: {
                code: 429,
                message: "You exceeded your current quota. Please retry in 3s.",
              },
            },
            { status: 429 },
          );
        }
        const body = (await req.json()) as { model: string };
        const chunk = (delta: Record<string, unknown>, finish: string | null) =>
          `data: ${JSON.stringify({
            id: "c1",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`;
        return new Response(
          `${chunk({ role: "assistant", content: "after the wait" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
  });

  afterAll(() => limited.stop(true));

  it("waits out a 429 for as long as the provider asked, then replies", async () => {
    const sleeps: number[] = [];
    const gateway = new ModelGateway({
      clock: {
        now: () => 0,
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      },
    });
    const waits: number[] = [];
    const reply = await chatWithModel(
      {
        ...resolved("good-key"),
        baseUrl: `http://127.0.0.1:${limited.port}/v1`,
      },
      [{ role: "user", content: "ping" }],
      { gateway, onWait: (ms) => waits.push(ms) },
    );
    expect(reply.text).toBe("after the wait");
    expect(waits).toEqual([3000]);
    expect(sleeps).toEqual([3000]);
  });

  it("refuses a context larger than the model's window", async () => {
    const err = await chatWithModel(
      { ...resolved("good-key"), details: { contextWindow: 10 } },
      [{ role: "user", content: "x".repeat(400) }],
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("context too large");
  });
});

describe("writeRunAgentConfig (coding subprocess)", () => {
  it("writes a per-run agent config naming only the role's model, with the key as an env reference", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xf-run-agent-"));
    try {
      const { agentDir, env, provider, model } = await writeRunAgentConfig(
        dir,
        resolved("super-secret-key"),
      );
      expect(provider).toBe(XFACTORY_PROVIDER_ID);
      expect(model).toBe("vendor/test-model");
      expect(env.PI_CODING_AGENT_DIR).toBe(agentDir);
      expect(env.XF_MODEL_API_KEY).toBe("super-secret-key");

      const modelsJson = await readFile(
        path.join(agentDir, "models.json"),
        "utf-8",
      );
      expect(modelsJson).not.toContain("super-secret-key");
      const parsed = JSON.parse(modelsJson) as {
        providers: Record<
          string,
          {
            baseUrl: string;
            api: string;
            apiKey: string;
            models: Array<{ id: string; contextWindow: number }>;
          }
        >;
      };
      const provider0 = parsed.providers[XFACTORY_PROVIDER_ID];
      expect(provider0?.baseUrl).toBe(base);
      expect(provider0?.api).toBe("openai-completions");
      expect(provider0?.apiKey).toBe("$XF_MODEL_API_KEY");
      expect(provider0?.models).toEqual([
        expect.objectContaining({
          id: "vendor/test-model",
          contextWindow: 32000,
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
