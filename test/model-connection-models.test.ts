// test/model-connection-models.test.ts — Check Connection marks a connection
// Verified and remembers its model list; chosen models get records whose
// details are auto-filled (provider list → runtime catalogue → empty) and stay
// editable (#277).

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "bun";
import {
  addConnectionModel,
  checkModelConnection,
  createModelConnection,
  getModelConnection,
  removeConnectionModel,
  updateConnectionModel,
  updateModelConnection,
} from "../src/model-connections.js";

let server: Server<undefined>;
let base: string;
let dataDir: string;
let savedDataDir: string | undefined;
let savedGemini: string | undefined;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.headers.get("x-goog-api-key") !== "good-key") {
        return new Response("{}", { status: 401 });
      }
      return Response.json({
        models: [
          {
            name: "models/listed-model",
            displayName: "Listed",
            inputTokenLimit: 32000,
            outputTokenLimit: 4000,
          },
          // Listed without limits: details fall back to the runtime catalogue.
          { name: "models/gemini-flash-lite-latest" },
        ],
      });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1beta`;
});

afterAll(() => server.stop(true));

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  savedGemini = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-model-records-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGemini;
  await rm(dataDir, { recursive: true, force: true });
});

async function geminiConnection(apiKey = "good-key") {
  return createModelConnection({
    name: "Gemini",
    apiType: "gemini",
    baseUrl: base,
    apiKey,
  });
}

describe("checkModelConnection", () => {
  it("marks the connection Verified and remembers the listed models when the check passes", async () => {
    const created = await geminiConnection();
    const result = await checkModelConnection(created.id);
    expect(result.ok).toBe(true);
    const after = await getModelConnection(created.id);
    expect(after?.verifiedAt).not.toBeNull();
    expect(after?.availableModels.map((m) => m.id)).toEqual([
      "listed-model",
      "gemini-flash-lite-latest",
    ]);
  });

  it("clears Verified and returns the categorised error when the check fails", async () => {
    const created = await geminiConnection("bad-key");
    await updateModelConnection(created.id, {
      verifiedAt: "2026-10-11T00:00:00.000Z",
    });
    const result = await checkModelConnection(created.id);
    expect(result).toEqual({
      ok: false,
      error: {
        category: "key_rejected",
        status: 401,
        message: "Key rejected (401)",
      },
    });
    expect((await getModelConnection(created.id))?.verifiedAt).toBeNull();
  });

  it("rejects an unknown connection", async () => {
    await expect(checkModelConnection("nope")).rejects.toThrow(/not found/i);
  });
});

describe("model records", () => {
  it("fills details from the provider's list first", async () => {
    const created = await geminiConnection();
    await checkModelConnection(created.id);
    const record = await addConnectionModel(created.id, "listed-model");
    expect(record).toEqual({
      modelId: "listed-model",
      name: "Listed",
      contextWindow: 32000,
      maxOutputTokens: 4000,
      limits: {},
      budget: { perDay: {} },
    });
  });

  it("falls back to the runtime catalogue for details the list doesn't publish", async () => {
    const created = await geminiConnection();
    await checkModelConnection(created.id);
    const record = await addConnectionModel(
      created.id,
      "gemini-flash-lite-latest",
    );
    expect(record.contextWindow).toBe(1048576);
    expect(record.maxOutputTokens).toBe(65536);
    expect(record.inputPricePerMTok).toBe(0.25);
    expect(record.outputPricePerMTok).toBe(1.5);
  });

  it("leaves details empty when nothing knows the model", async () => {
    const created = await geminiConnection();
    const record = await addConnectionModel(created.id, "mystery-model");
    expect(record).toEqual({
      modelId: "mystery-model",
      limits: {},
      budget: { perDay: {} },
    });
  });

  it("edits details, limits and budget, and the edits persist", async () => {
    const created = await geminiConnection();
    await addConnectionModel(created.id, "mystery-model");
    await updateConnectionModel(created.id, "mystery-model", {
      contextWindow: 200000,
      inputPricePerMTok: 1,
      limits: { rpm: 5, rpd: 500 },
      budget: { perDay: { usd: 5 } },
    });
    const after = await getModelConnection(created.id);
    expect(after?.models).toEqual([
      {
        modelId: "mystery-model",
        contextWindow: 200000,
        inputPricePerMTok: 1,
        limits: { rpm: 5, rpd: 500 },
        budget: { perDay: { usd: 5 } },
      },
    ]);
  });

  it("adding a model twice keeps one record; removing it drops it", async () => {
    const created = await geminiConnection();
    await addConnectionModel(created.id, "mystery-model");
    await addConnectionModel(created.id, "mystery-model");
    expect((await getModelConnection(created.id))?.models).toHaveLength(1);
    await removeConnectionModel(created.id, "mystery-model");
    expect((await getModelConnection(created.id))?.models).toEqual([]);
  });

  it("rejects editing or removing a model the connection doesn't have", async () => {
    const created = await geminiConnection();
    await expect(
      updateConnectionModel(created.id, "nope", { contextWindow: 1 }),
    ).rejects.toThrow(/not found/i);
    await expect(removeConnectionModel(created.id, "nope")).rejects.toThrow(
      /not found/i,
    );
  });
});
