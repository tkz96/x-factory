// test/model-connections-api.test.ts — HTTP contract for model connections:
// CRUD, keys never returned, validation errors, unknown ids (#276).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { handleApi } from "../src/http/routes.js";

let repos: Repositories;
let dataDir: string;
let savedDataDir: string | undefined;
let savedGemini: string | undefined;

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  savedGemini = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-model-api-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  repos = createRepositories(db);
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGemini;
  await rm(dataDir, { recursive: true, force: true });
});

async function call(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> & unknown[] }> {
  const req = new Request(`http://localhost:3777${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handleApi(req, new URL(req.url), { repos });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const KEY = "AQ.api-test-key-00000000000000000009876";

describe("/api/model-connections (#276)", () => {
  it("creates, lists, reads, updates and deletes a connection without ever returning the key", async () => {
    const created = await call("POST", "/api/model-connections", {
      name: "My Gemini key",
      apiType: "gemini",
      apiKey: KEY,
    });
    expect(created.status).toBe(201);
    expect(created.json.hasKey).toBe(true);
    expect(created.json.keyLast4).toBe("9876");
    const id = created.json.id as string;

    const list = await call("GET", "/api/model-connections");
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);

    const one = await call("GET", `/api/model-connections/${id}`);
    expect(one.status).toBe(200);
    expect(one.json.name).toBe("My Gemini key");

    const patched = await call("PATCH", `/api/model-connections/${id}`, {
      name: "Gemini",
    });
    expect(patched.status).toBe(200);
    expect(patched.json.name).toBe("Gemini");
    expect(patched.json.keyLast4).toBe("9876");

    for (const r of [created, list, one, patched]) {
      expect(JSON.stringify(r.json)).not.toContain(KEY);
    }

    const deleted = await call("DELETE", `/api/model-connections/${id}`);
    expect(deleted.status).toBe(200);
    expect((await call("GET", `/api/model-connections/${id}`)).status).toBe(
      404,
    );
  });

  it("rejects an invalid API type or a missing name with 400", async () => {
    expect(
      (
        await call("POST", "/api/model-connections", {
          name: "x",
          apiType: "ollama",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/model-connections", { apiType: "gemini" }))
        .status,
    ).toBe(400);
  });

  it("rejects an OpenAI-compatible connection without a base URL with 400", async () => {
    const res = await call("POST", "/api/model-connections", {
      name: "router",
      apiType: "openai-compatible",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown connection", async () => {
    expect(
      (await call("PATCH", "/api/model-connections/nope", { name: "x" }))
        .status,
    ).toBe(404);
    expect((await call("DELETE", "/api/model-connections/nope")).status).toBe(
      404,
    );
  });
});

describe("/api/model-connections — check and models (#277)", () => {
  let fake: ReturnType<typeof Bun.serve>;
  let fakeBase: string;

  beforeEach(() => {
    fake = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.headers.get("x-goog-api-key") !== KEY) {
          return new Response("{}", { status: 401 });
        }
        return Response.json({
          models: [
            {
              name: "models/listed-model",
              inputTokenLimit: 32000,
              outputTokenLimit: 4000,
            },
          ],
        });
      },
    });
    fakeBase = `http://127.0.0.1:${fake.port}/v1beta`;
  });

  afterEach(() => fake.stop(true));

  it("checks a connection, then adds, edits and removes a model (IDs may contain slashes)", async () => {
    const created = await call("POST", "/api/model-connections", {
      name: "Gemini",
      apiType: "gemini",
      baseUrl: fakeBase,
      apiKey: KEY,
    });
    const id = created.json.id as string;

    const checked = await call("POST", `/api/model-connections/${id}/check`);
    expect(checked.status).toBe(200);
    expect(checked.json.ok).toBe(true);
    expect(JSON.stringify(checked.json)).not.toContain(KEY);
    const view = await call("GET", `/api/model-connections/${id}`);
    expect(view.json.verifiedAt).not.toBeNull();

    const added = await call("POST", `/api/model-connections/${id}/models`, {
      modelId: "listed-model",
    });
    expect(added.status).toBe(201);
    expect(added.json.contextWindow).toBe(32000);

    const slashed = await call("POST", `/api/model-connections/${id}/models`, {
      modelId: "vendor/model-x",
    });
    expect(slashed.status).toBe(201);

    const edited = await call(
      "PATCH",
      `/api/model-connections/${id}/models?modelId=${encodeURIComponent("vendor/model-x")}`,
      {
        contextWindow: 128000,
        limits: { rpm: 5 },
        budget: { perDay: { usd: 2 } },
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.json.limits).toEqual({ rpm: 5 });

    const removed = await call(
      "DELETE",
      `/api/model-connections/${id}/models?modelId=${encodeURIComponent("vendor/model-x")}`,
    );
    expect(removed.status).toBe(200);
    const after = await call("GET", `/api/model-connections/${id}`);
    expect(
      (after.json.models as Array<{ modelId: string }>).map((m) => m.modelId),
    ).toEqual(["listed-model"]);
  });

  it("returns a failing check as 200 with the categorised error", async () => {
    const created = await call("POST", "/api/model-connections", {
      name: "Gemini",
      apiType: "gemini",
      baseUrl: fakeBase,
      apiKey: "wrong-key",
    });
    const checked = await call(
      "POST",
      `/api/model-connections/${created.json.id as string}/check`,
    );
    expect(checked.status).toBe(200);
    expect(checked.json as unknown).toEqual({
      ok: false,
      error: {
        category: "key rejected",
        status: 401,
        message: "Key rejected (401)",
      },
    });
  });

  it("rejects invalid model edits with 400 and unknown models with 404", async () => {
    const created = await call("POST", "/api/model-connections", {
      name: "Gemini",
      apiType: "gemini",
      apiKey: KEY,
    });
    const id = created.json.id as string;
    expect(
      (await call("POST", `/api/model-connections/${id}/models`, {})).status,
    ).toBe(400);
    await call("POST", `/api/model-connections/${id}/models`, { modelId: "m" });
    expect(
      (
        await call("PATCH", `/api/model-connections/${id}/models?modelId=m`, {
          contextWindow: -5,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "PATCH",
          `/api/model-connections/${id}/models?modelId=zz`,
          {},
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/model-connections/${id}/models`)).status,
    ).toBe(400);
  });
});
