// test/model-connections.test.ts — X-Factory-owned model connections: where
// models come from (name, API type, base URL, API key). Keys live in a private
// secrets file and are never returned; an existing LLM_API_KEY is imported once
// on first launch; provider env vars override stored keys (#276).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createModelConnection,
  DEFAULT_BASE_URLS,
  deleteModelConnection,
  getModelConnection,
  importLegacyModelKey,
  listModelConnections,
  resolveModelConnectionKey,
  updateModelConnection,
} from "../src/model-connections.js";
import { getModelConnectionsPath, getModelSecretsPath } from "../src/paths.js";

const ENV_KEYS = [
  "X_FACTORY_DATA_DIR",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "LLM_API_KEY",
  "LLM_PROVIDER",
] as const;

let dataDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-model-connections-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await rm(dataDir, { recursive: true, force: true });
});

const GEMINI_KEY = "AQ.test-gemini-key-0000000000000000wxyz";

describe("model connections store", () => {
  it("creates a connection that reports only whether a key is set and its last 4 characters", async () => {
    const created = await createModelConnection({
      name: "My Gemini key",
      apiType: "gemini",
      apiKey: GEMINI_KEY,
    });
    expect(created.name).toBe("My Gemini key");
    expect(created.apiType).toBe("gemini");
    expect(created.hasKey).toBe(true);
    expect(created.keyLast4).toBe("wxyz");
    expect(JSON.stringify(created)).not.toContain(GEMINI_KEY);
    expect(await listModelConnections()).toEqual([created]);
    expect(await getModelConnection(created.id)).toEqual(created);
  });

  it("pre-fills the default base URL for Gemini and Anthropic", async () => {
    const gemini = await createModelConnection({
      name: "g",
      apiType: "gemini",
    });
    const anthropic = await createModelConnection({
      name: "a",
      apiType: "anthropic",
    });
    expect(gemini.baseUrl).toBe(DEFAULT_BASE_URLS.gemini);
    expect(anthropic.baseUrl).toBe(DEFAULT_BASE_URLS.anthropic);
  });

  it("requires a base URL for an OpenAI-compatible connection", async () => {
    await expect(
      createModelConnection({ name: "router", apiType: "openai-compatible" }),
    ).rejects.toThrow(/base URL/i);
    const router = await createModelConnection({
      name: "OpenRouter",
      apiType: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(router.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(router.hasKey).toBe(false);

    const localRouter = await createModelConnection({
      name: "Local",
      apiType: "openai-compatible",
      baseUrl: "localhost:3001/v1",
    });
    expect(localRouter.baseUrl).toBe("http://localhost:3001/v1");

    const remoteRouter = await createModelConnection({
      name: "Remote",
      apiType: "openai-compatible",
      baseUrl: "api.example.com/v1",
    });
    expect(remoteRouter.baseUrl).toBe("https://api.example.com/v1");
  });

  it("keeps keys in an owner-only secrets file, never in the connections file", async () => {
    await createModelConnection({
      name: "g",
      apiType: "gemini",
      apiKey: GEMINI_KEY,
    });
    const connectionsFile = await readFile(getModelConnectionsPath(), "utf-8");
    const secretsFile = await readFile(getModelSecretsPath(), "utf-8");
    expect(connectionsFile).not.toContain(GEMINI_KEY);
    expect(secretsFile).toContain(GEMINI_KEY);
    expect((await stat(getModelSecretsPath())).mode & 0o777).toBe(0o600);
    expect(path.dirname(getModelSecretsPath())).toBe(dataDir);
  });

  it("updates fields, keeps the key when none is sent, replaces it when one is, and clears Verified on key or URL edits", async () => {
    const created = await createModelConnection({
      name: "router",
      apiType: "openai-compatible",
      baseUrl: "https://a.example/v1",
      apiKey: "sk-first-key-1111",
    });
    await updateModelConnection(created.id, {
      verifiedAt: "2026-10-11T00:00:00.000Z",
    });

    const renamed = await updateModelConnection(created.id, { name: "Router" });
    expect(renamed.name).toBe("Router");
    expect(renamed.keyLast4).toBe("1111");
    expect(renamed.verifiedAt).toBe("2026-10-11T00:00:00.000Z");

    const rekeyed = await updateModelConnection(created.id, {
      apiKey: "sk-second-key-2222",
    });
    expect(rekeyed.keyLast4).toBe("2222");
    expect(rekeyed.verifiedAt).toBeNull();
    expect(await resolveModelConnectionKey(created.id)).toBe(
      "sk-second-key-2222",
    );

    await updateModelConnection(created.id, {
      verifiedAt: "2026-10-11T00:00:00.000Z",
    });
    const moved = await updateModelConnection(created.id, {
      baseUrl: "https://b.example/v1",
    });
    expect(moved.verifiedAt).toBeNull();
  });

  it("removes a key when an empty one is sent, and deletes the connection with its key", async () => {
    const created = await createModelConnection({
      name: "g",
      apiType: "gemini",
      apiKey: GEMINI_KEY,
    });
    const cleared = await updateModelConnection(created.id, { apiKey: "" });
    expect(cleared.hasKey).toBe(false);
    expect(await resolveModelConnectionKey(created.id)).toBeUndefined();

    await updateModelConnection(created.id, { apiKey: GEMINI_KEY });
    await deleteModelConnection(created.id);
    expect(await getModelConnection(created.id)).toBeUndefined();
    expect(await readFile(getModelSecretsPath(), "utf-8")).not.toContain(
      GEMINI_KEY,
    );
  });

  it("rejects updating or deleting an unknown connection", async () => {
    await expect(updateModelConnection("nope", { name: "x" })).rejects.toThrow(
      /not found/i,
    );
    await expect(deleteModelConnection("nope")).rejects.toThrow(/not found/i);
  });

  it("lets a provider env var override the stored key for official endpoints", async () => {
    const created = await createModelConnection({
      name: "g",
      apiType: "gemini",
      apiKey: GEMINI_KEY,
    });
    process.env.GEMINI_API_KEY = "env-override-key";
    expect(await resolveModelConnectionKey(created.id)).toBe(
      "env-override-key",
    );
    const view = await getModelConnection(created.id);
    expect(view?.keySource).toBe("environment");
  });

  it("does not let a provider env var override connections with custom base URLs", async () => {
    const created = await createModelConnection({
      name: "openrouter",
      apiType: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-stored-key-9999",
    });
    process.env.OPENAI_API_KEY = "openai-env-key";
    expect(await resolveModelConnectionKey(created.id)).toBe(
      "sk-or-stored-key-9999",
    );
    const view = await getModelConnection(created.id);
    expect(view?.keySource).toBe("stored");
  });
});

describe("importLegacyModelKey", () => {
  it("does nothing without LLM_API_KEY", async () => {
    expect(await importLegacyModelKey()).toBeUndefined();
    expect(await listModelConnections()).toEqual([]);
  });

  it("imports an AQ. Google key as a Gemini connection", async () => {
    process.env.LLM_API_KEY = GEMINI_KEY;
    const imported = await importLegacyModelKey();
    expect(imported?.apiType).toBe("gemini");
    expect(imported?.keyLast4).toBe("wxyz");
    expect(await resolveModelConnectionKey(imported?.id ?? "")).toBe(
      GEMINI_KEY,
    );
  });

  it("detects AIzaSy, sk-ant- and sk- keys, and honours LLM_PROVIDER", async () => {
    const cases: Array<[string, string | undefined, string]> = [
      ["AIzaSyEXAMPLEKEY000", undefined, "gemini"],
      ["sk-ant-EXAMPLE000", undefined, "anthropic"],
      ["sk-EXAMPLE000", undefined, "openai-compatible"],
      ["opaque-key-000", "gemini", "gemini"],
      ["opaque-key-000", "anthropic", "anthropic"],
    ];
    for (const [key, provider, expected] of cases) {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-model-import-"));
      process.env.X_FACTORY_DATA_DIR = dir;
      process.env.LLM_API_KEY = key;
      if (provider) process.env.LLM_PROVIDER = provider;
      else delete process.env.LLM_PROVIDER;
      const imported = await importLegacyModelKey();
      expect(`${key}:${imported?.apiType}`).toBe(`${key}:${expected}`);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("imports only once, even if the imported connection is later deleted", async () => {
    process.env.LLM_API_KEY = GEMINI_KEY;
    const first = await importLegacyModelKey();
    expect(await importLegacyModelKey()).toBeUndefined();
    await deleteModelConnection(first?.id ?? "");
    expect(await importLegacyModelKey()).toBeUndefined();
    expect(await listModelConnections()).toEqual([]);
  });

  it("skips an unrecognised key with no LLM_PROVIDER instead of guessing", async () => {
    process.env.LLM_API_KEY = "opaque-key-000";
    expect(await importLegacyModelKey()).toBeUndefined();
    expect(await listModelConnections()).toEqual([]);
  });
});
