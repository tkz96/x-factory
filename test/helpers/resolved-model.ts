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
  };
}

/** Stands in for resolveRole: every role resolves to the test model. */
export async function stubResolveRole(
  role: ModelRoleName,
): Promise<ResolvedModel> {
  return testResolvedModel(role);
}
