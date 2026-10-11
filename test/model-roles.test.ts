// test/model-roles.test.ts — Builder and Reviewer roles: each points at a model
// on a verified connection. A role resolves to everything a model call needs,
// or fails with a clear "model unavailable" reason — never a fallback (#278).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateLegacyRoles } from "../src/legacy-roles.js";
import {
  addConnectionModel,
  createModelConnection,
  updateConnectionModel,
  updateModelConnection,
} from "../src/model-connections.js";
import {
  assertRolesReady,
  ModelUnavailableError,
  resolveRole,
} from "../src/model-roles.js";
import { loadSettings, saveSettings } from "../src/settings.js";

const ENV_KEYS = [
  "X_FACTORY_DATA_DIR",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
] as const;
let saved: Record<string, string | undefined>;
let dataDir: string;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-model-roles-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(dataDir, { recursive: true, force: true });
});

async function verifiedGemini(apiKey: string | undefined = "AQ.key-1234") {
  const c = await createModelConnection({
    name: "Gemini",
    apiType: "gemini",
    apiKey,
  });
  await updateModelConnection(c.id, { verifiedAt: "2026-10-11T00:00:00.000Z" });
  return c;
}

describe("resolveRole", () => {
  it("resolves a role to its connection, model, key and recorded details", async () => {
    const c = await verifiedGemini();
    await addConnectionModel(c.id, "gemini-flash-lite-latest");
    await updateConnectionModel(c.id, "gemini-flash-lite-latest", {
      contextWindow: 500000,
    });
    await saveSettings({
      roles: {
        builder: { connectionId: c.id, modelId: "gemini-flash-lite-latest" },
      },
    });

    const resolved = await resolveRole("builder");
    expect(resolved).toMatchObject({
      role: "builder",
      connectionId: c.id,
      connectionName: "Gemini",
      apiType: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      modelId: "gemini-flash-lite-latest",
      apiKey: "AQ.key-1234",
    });
    // The recorded edit wins; the rest falls back to the runtime catalogue.
    expect(resolved.details.contextWindow).toBe(500000);
    expect(resolved.details.maxOutputTokens).toBe(65536);
    expect(resolved.details.reasoning).toBe(true);
  });

  it("fails with 'model unavailable' when the role is unset", async () => {
    const err = await resolveRole("reviewer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("model unavailable");
    expect((err as Error).message).toContain("Settings › Models");
  });

  it("fails when the connection is gone, unverified, or has no key", async () => {
    await saveSettings({
      roles: { builder: { connectionId: "gone", modelId: "m" } },
    });
    expect(
      await resolveRole("builder").catch((e: unknown) => e),
    ).toBeInstanceOf(ModelUnavailableError);

    const unverified = await createModelConnection({
      name: "G",
      apiType: "gemini",
      apiKey: "k",
    });
    await saveSettings({
      roles: { builder: { connectionId: unverified.id, modelId: "m" } },
    });
    const notChecked = (await resolveRole("builder").catch(
      (e: unknown) => e,
    )) as Error;
    expect(notChecked.message).toMatch(/not been checked|Check Connection/);

    const keyless = await verifiedGemini("");
    await saveSettings({
      roles: { builder: { connectionId: keyless.id, modelId: "m" } },
    });
    const noKey = (await resolveRole("builder").catch(
      (e: unknown) => e,
    )) as Error;
    expect(noKey.message).toMatch(/no API key/i);
  });
});

describe("assertRolesReady", () => {
  it("passes when both roles resolve, and names every unready role otherwise", async () => {
    const err = (await assertRolesReady().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect(err.message).toContain("Builder");
    expect(err.message).toContain("Reviewer");

    const c = await verifiedGemini();
    await saveSettings({
      roles: {
        builder: { connectionId: c.id, modelId: "gemini-flash-lite-latest" },
        reviewer: { connectionId: c.id, modelId: "gemini-flash-lite-latest" },
      },
    });
    await expect(assertRolesReady()).resolves.toBeUndefined();
  });
});

describe("migrating Session A / Session B", () => {
  it("maps each session to a connection of the matching API type, else leaves the role unset", async () => {
    const c = await verifiedGemini();
    const roles = await migrateLegacyRoles({
      sessionA: { provider: "google", model: "gemini-flash-lite-latest" },
      sessionB: { provider: "ollama", model: "qwen2.5-coder:32b" },
    });
    expect(roles).toEqual({
      builder: { connectionId: c.id, modelId: "gemini-flash-lite-latest" },
    });
  });

  it("loadSettings derives roles from legacy sessions when none are saved", async () => {
    const c = await verifiedGemini();
    await saveSettings({
      models: { sessionA: { provider: "gemini", model: "gemini-x" } },
    });
    const settings = await loadSettings();
    expect(settings.roles?.builder).toEqual({
      connectionId: c.id,
      modelId: "gemini-x",
    });
    expect(settings.roles?.reviewer).toBeUndefined();
  });

  it("has no hard-coded default model", async () => {
    const settings = await loadSettings();
    expect(settings.models?.sessionA?.model).toBeUndefined();
    expect(settings.models?.sessionB?.model).toBeUndefined();
    expect(settings.roles?.builder).toBeUndefined();
  });
});
