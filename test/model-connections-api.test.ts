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
