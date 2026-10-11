// test/helpers/resolved-model.ts — A role resolved to a local endpoint, for
// executor tests that inject their own Pi session or loop and need the role
// seam satisfied without a real connection (#278).

import type { ResolvedModel } from "../../src/model-roles.js";
import type { ModelRoleName } from "../../src/shared/types.js";

export function testResolvedModel(
  role: ModelRoleName = "reviewer",
): ResolvedModel {
  return {
    role,
    connectionId: "test-connection",
    connectionName: "Test connection",
    apiType: "openai-compatible",
    baseUrl: "http://127.0.0.1:9/v1",
    modelId: "test/model",
    apiKey: "test-key",
    details: { contextWindow: 32000, maxOutputTokens: 4000 },
    limits: {},
  };
}

/** Stands in for resolveRole: every role resolves to the test model. */
export async function stubResolveRole(
  role: ModelRoleName,
): Promise<ResolvedModel> {
  return testResolvedModel(role);
}

/**
 * Runs `fn` against a fresh data dir holding a verified Gemini connection and
 * both roles assigned to it, so a run can start (#278). Restores the previous
 * data dir afterwards.
 */
export async function withReadyModelRoles<T>(fn: () => Promise<T>): Promise<T> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createModelConnection, updateModelConnection } = await import(
    "../../src/model-connections.js"
  );
  const { saveSettings } = await import("../../src/settings.js");

  const saved = process.env.X_FACTORY_DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "xf-ready-roles-"));
  process.env.X_FACTORY_DATA_DIR = dir;
  try {
    const connection = await createModelConnection({
      name: "Test Gemini",
      apiType: "gemini",
      apiKey: "AQ.test-key",
    });
    await updateModelConnection(connection.id, {
      verifiedAt: new Date().toISOString(),
    });
    const role = {
      connectionId: connection.id,
      modelId: "gemini-flash-lite-latest",
    };
    await saveSettings({ roles: { builder: role, reviewer: role } });
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.X_FACTORY_DATA_DIR;
    else process.env.X_FACTORY_DATA_DIR = saved;
    await rm(dir, { recursive: true, force: true });
  }
}
