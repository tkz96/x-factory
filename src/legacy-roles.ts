// src/legacy-roles.ts — Migrates Session A / Session B model settings to the
// Builder and Reviewer roles (#278). Each session's provider is matched to a
// model connection of the same API type; a session with no matching
// connection leaves its role unset rather than guessing.

import { listModelConnections } from "./model-connections.js";
import type { ModelApiType } from "./shared/model-connection-types.js";
import type { ModelRoles, RoleAssignment } from "./shared/types.js";

interface LegacyEntry {
  provider?: string | undefined;
  model?: string | undefined;
}

const PROVIDER_API_TYPES: Readonly<Record<string, ModelApiType>> = {
  google: "gemini",
  gemini: "gemini",
  anthropic: "anthropic",
  openai: "openai-compatible",
  openrouter: "openai-compatible",
};

export async function migrateLegacyRoles(
  models:
    | { sessionA?: LegacyEntry | undefined; sessionB?: LegacyEntry | undefined }
    | undefined,
): Promise<ModelRoles> {
  const connections = await listModelConnections();
  const assign = (entry?: LegacyEntry): RoleAssignment | undefined => {
    const apiType = PROVIDER_API_TYPES[entry?.provider?.toLowerCase() ?? ""];
    const modelId = entry?.model?.trim();
    if (!apiType || !modelId) return undefined;
    const connection = connections.find((c) => c.apiType === apiType);
    return connection ? { connectionId: connection.id, modelId } : undefined;
  };
  const roles: ModelRoles = {};
  const builder = assign(models?.sessionA);
  const reviewer = assign(models?.sessionB);
  if (builder) roles.builder = builder;
  if (reviewer) roles.reviewer = reviewer;
  return roles;
}
