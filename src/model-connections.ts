// src/model-connections.ts — X-Factory-owned model connections (#276): where
// models come from. A connection is a name, an API type, a base URL and an API
// key. Non-secret fields live in the data dir's model-connections.json; keys
// live in model-secrets.json, written owner-only (0600) and never returned to a
// caller — views carry only whether a key is set and its last four characters.
//
// A provider key env var (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)
// overrides the stored key for connections of that API type, for headless
// setups. On first launch an existing LLM_API_KEY is imported as a connection,
// once. X-Factory never reads or writes the agent runtime's own ~/.pi config.

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  detectLegacyKeyProvider,
  type LegacyKeyProvider,
} from "./env-bootstrap.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { listProviderModels, runtimeCatalogDetails } from "./model-catalog.js";
import { getModelConnectionsPath, getModelSecretsPath } from "./paths.js";
import type {
  DiscoveredModel,
  ModelApiType,
  ModelConnectionView,
  ModelDetails,
  ModelListResult,
  ModelRecord,
  ModelRecordPatch,
} from "./shared/model-connection-types.js";

/** Base URLs pre-filled for API types with one well-known endpoint. */
export const DEFAULT_BASE_URLS: Readonly<
  Record<Exclude<ModelApiType, "openai-compatible">, string>
> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com",
};

/** Official endpoints for each API type. Provider env vars override only these. */
export const OFFICIAL_BASE_URLS: Readonly<Record<ModelApiType, string>> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "https://api.openai.com/v1",
};

export function isOfficialEndpoint(
  apiType: ModelApiType,
  baseUrl?: string,
): boolean {
  if (!baseUrl) return true;
  const normalize = (u: string) => u.trim().replace(/\/+$/, "");
  return normalize(baseUrl) === normalize(OFFICIAL_BASE_URLS[apiType]);
}

/** The env var that overrides the stored key for each API type. */
export const KEY_ENV_VARS: Readonly<Record<ModelApiType, string>> = {
  "openai-compatible": "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** A connection as stored (no key). */
interface StoredConnection {
  id: string;
  name: string;
  apiType: ModelApiType;
  baseUrl: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Models chosen for use, with their details. */
  models: ModelRecord[];
  /** The model list from the last passing check. */
  availableModels: DiscoveredModel[];
}

interface ConnectionsFile {
  connections: StoredConnection[];
  /** Set once the first-launch LLM_API_KEY import has run, whatever its outcome. */
  legacyKeyImported?: boolean;
}

type SecretsFile = Record<string, string>;

export type { ModelConnectionView, ModelRecord, ModelRecordPatch };

export interface CreateModelConnectionInput {
  name: string;
  apiType: ModelApiType;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
}

export interface UpdateModelConnectionInput {
  name?: string | undefined;
  baseUrl?: string | undefined;
  /** A new key; an empty string removes the stored key. */
  apiKey?: string | undefined;
  verifiedAt?: string | null | undefined;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Writes via a temp file and rename, owner-only, so a crash never leaves half a file. */
async function writeJsonPrivate(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

async function readConnections(): Promise<ConnectionsFile> {
  const file = await readJson<ConnectionsFile>(getModelConnectionsPath(), {
    connections: [],
  });
  // Connections saved before model records existed (#276) have neither list.
  file.connections = file.connections.map((c) => ({
    ...c,
    models: c.models ?? [],
    availableModels: c.availableModels ?? [],
  }));
  return file;
}
const readSecrets = () => readJson<SecretsFile>(getModelSecretsPath(), {});

function connectionEnvKey(
  connection: Pick<StoredConnection, "apiType" | "baseUrl">,
): string | undefined {
  if (!isOfficialEndpoint(connection.apiType, connection.baseUrl)) {
    return undefined;
  }
  const value = process.env[KEY_ENV_VARS[connection.apiType]]?.trim();
  return value ? value : undefined;
}

function toView(
  connection: StoredConnection,
  secrets: SecretsFile,
): ModelConnectionView {
  const stored = secrets[connection.id];
  const fromEnv = connectionEnvKey(connection);
  const effective = fromEnv ?? stored;
  return {
    ...connection,
    hasKey: Boolean(effective),
    keyLast4: effective ? effective.slice(-4) : null,
    keySource: fromEnv ? "environment" : stored ? "stored" : "none",
  };
}

function resolveBaseUrl(apiType: ModelApiType, baseUrl?: string): string {
  let trimmed = baseUrl?.trim();
  if (trimmed) {
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed);
      trimmed = isLocal ? `http://${trimmed}` : `https://${trimmed}`;
    }
    return trimmed;
  }
  if (apiType === "openai-compatible") {
    throw new ValidationError(
      "An OpenAI-compatible connection needs a base URL.",
    );
  }
  return DEFAULT_BASE_URLS[apiType];
}

export async function listModelConnections(): Promise<ModelConnectionView[]> {
  const [file, secrets] = await Promise.all([readConnections(), readSecrets()]);
  return file.connections.map((c) => toView(c, secrets));
}

export async function getModelConnection(
  id: string,
): Promise<ModelConnectionView | undefined> {
  return (await listModelConnections()).find((c) => c.id === id);
}

export async function createModelConnection(
  input: CreateModelConnectionInput,
): Promise<ModelConnectionView> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("A connection needs a name.");
  const now = new Date().toISOString();
  const connection: StoredConnection = {
    id: randomUUID(),
    name,
    apiType: input.apiType,
    baseUrl: resolveBaseUrl(input.apiType, input.baseUrl),
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    models: [],
    availableModels: [],
  };
  const [file, secrets] = await Promise.all([readConnections(), readSecrets()]);
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    secrets[connection.id] = apiKey;
    await writeJsonPrivate(getModelSecretsPath(), secrets);
  }
  file.connections.push(connection);
  await writeJsonPrivate(getModelConnectionsPath(), file);
  return toView(connection, secrets);
}

export async function updateModelConnection(
  id: string,
  patch: UpdateModelConnectionInput,
): Promise<ModelConnectionView> {
  const [file, secrets] = await Promise.all([readConnections(), readSecrets()]);
  const index = file.connections.findIndex((c) => c.id === id);
  const current = file.connections[index];
  if (!current) throw new NotFoundError(`Model connection "${id}" not found.`);

  const next: StoredConnection = { ...current };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError("A connection needs a name.");
    next.name = name;
  }
  let credentialsChanged = false;
  if (patch.baseUrl !== undefined) {
    const baseUrl = resolveBaseUrl(current.apiType, patch.baseUrl);
    credentialsChanged ||= baseUrl !== current.baseUrl;
    next.baseUrl = baseUrl;
  }
  if (patch.apiKey !== undefined) {
    const apiKey = patch.apiKey.trim();
    credentialsChanged ||= apiKey !== (secrets[id] ?? "");
    if (apiKey) secrets[id] = apiKey;
    else delete secrets[id];
    await writeJsonPrivate(getModelSecretsPath(), secrets);
  }
  if (patch.verifiedAt !== undefined) next.verifiedAt = patch.verifiedAt;
  // A changed key or endpoint has not been checked: Verified must be earned again.
  if (credentialsChanged) next.verifiedAt = null;
  next.updatedAt = new Date().toISOString();

  file.connections[index] = next;
  await writeJsonPrivate(getModelConnectionsPath(), file);
  return toView(next, secrets);
}

export async function deleteModelConnection(id: string): Promise<void> {
  const [file, secrets] = await Promise.all([readConnections(), readSecrets()]);
  if (!file.connections.some((c) => c.id === id)) {
    throw new NotFoundError(`Model connection "${id}" not found.`);
  }
  file.connections = file.connections.filter((c) => c.id !== id);
  if (id in secrets) {
    delete secrets[id];
    await writeJsonPrivate(getModelSecretsPath(), secrets);
  }
  await writeJsonPrivate(getModelConnectionsPath(), file);
}

/**
 * The key a model call should use for a connection: the API type's env var
 * when set, else the stored key. Server-side only — never sent to a client.
 */
export async function resolveModelConnectionKey(
  id: string,
): Promise<string | undefined> {
  const file = await readConnections();
  const connection = file.connections.find((c) => c.id === id);
  if (!connection) return undefined;
  return connectionEnvKey(connection) ?? (await readSecrets())[id];
}

const IMPORTED_CONNECTION_CONFIG: Readonly<
  Record<
    LegacyKeyProvider,
    { name: string; apiType: ModelApiType; baseUrl?: string }
  >
> = {
  gemini: {
    name: "Gemini (imported)",
    apiType: "gemini",
  },
  anthropic: {
    name: "Anthropic (imported)",
    apiType: "anthropic",
  },
  openai: {
    name: "OpenAI (imported)",
    apiType: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
  },
};

/**
 * First-launch import (#276): turns an existing `LLM_API_KEY` (+ optional
 * `LLM_PROVIDER`) into a connection, once. A key whose provider can't be told
 * from LLM_PROVIDER or its prefix is skipped rather than guessed. Returns the
 * imported connection, or undefined when nothing was imported.
 */
export async function importLegacyModelKey(): Promise<
  ModelConnectionView | undefined
> {
  const file = await readConnections();
  if (file.legacyKeyImported) return undefined;

  const key = process.env.LLM_API_KEY?.trim();
  const provider = key
    ? detectLegacyKeyProvider(key, process.env.LLM_PROVIDER)
    : undefined;

  let imported: ModelConnectionView | undefined;
  if (key && provider) {
    const config = IMPORTED_CONNECTION_CONFIG[provider];
    imported = await createModelConnection({
      name: config.name,
      apiType: config.apiType,
      baseUrl: config.baseUrl,
      apiKey: key,
    });
  }
  // Only a launch that had a key to look at completes the import, so a key
  // added to .env later is still picked up once.
  if (key) {
    const latest = await readConnections();
    latest.legacyKeyImported = true;
    await writeJsonPrivate(getModelConnectionsPath(), latest);
  }
  return imported;
}

/** Reads, edits and writes one connection; throws NotFoundError for an unknown id. */
async function mutateConnection<T>(
  id: string,
  edit: (connection: StoredConnection) => T,
): Promise<T> {
  const file = await readConnections();
  const connection = file.connections.find((c) => c.id === id);
  if (!connection)
    throw new NotFoundError(`Model connection "${id}" not found.`);
  const result = edit(connection);
  connection.updatedAt = new Date().toISOString();
  await writeJsonPrivate(getModelConnectionsPath(), file);
  return result;
}

/**
 * Check Connection (#277): one real request to the provider's model list. A
 * passing check marks the connection Verified and remembers the list; a
 * failing one clears Verified and returns the categorised error.
 */
export async function checkModelConnection(
  id: string,
  fetchFn?: typeof fetch,
): Promise<ModelListResult> {
  const connection = await getModelConnection(id);
  if (!connection)
    throw new NotFoundError(`Model connection "${id}" not found.`);
  const result = await listProviderModels({
    apiType: connection.apiType,
    baseUrl: connection.baseUrl,
    apiKey: await resolveModelConnectionKey(id),
    ...(fetchFn ? { fetchFn } : {}),
  });
  await mutateConnection(id, (c) => {
    if (result.ok) {
      c.verifiedAt = new Date().toISOString();
      c.availableModels = result.models;
    } else {
      c.verifiedAt = null;
    }
  });
  return result;
}

/** Details for a newly chosen model: the provider's list, then the runtime catalogue. */
function autoFilledDetails(
  connection: StoredConnection,
  modelId: string,
): ModelDetails & { name?: string | undefined } {
  const listed = connection.availableModels.find((m) => m.id === modelId);
  const catalog = runtimeCatalogDetails(
    connection.apiType,
    connection.baseUrl,
    modelId,
  );
  const pick = <K extends keyof ModelDetails>(key: K) =>
    listed?.[key] ?? catalog?.[key];
  const details = {
    name: listed?.name,
    contextWindow: pick("contextWindow"),
    maxOutputTokens: pick("maxOutputTokens"),
    inputPricePerMTok: pick("inputPricePerMTok"),
    outputPricePerMTok: pick("outputPricePerMTok"),
  };
  return Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== undefined),
  );
}

/** Adds a model to a connection (idempotent), with auto-filled details. */
export async function addConnectionModel(
  id: string,
  modelId: string,
): Promise<ModelRecord> {
  const trimmed = modelId.trim();
  if (!trimmed) throw new ValidationError("A model needs an ID.");
  return mutateConnection(id, (c) => {
    const existing = c.models.find((m) => m.modelId === trimmed);
    if (existing) return existing;
    const record: ModelRecord = {
      modelId: trimmed,
      ...autoFilledDetails(c, trimmed),
      limits: {},
      budget: { perDay: {} },
    };
    c.models.push(record);
    return record;
  });
}

function findModel(c: StoredConnection, modelId: string): ModelRecord {
  const record = c.models.find((m) => m.modelId === modelId);
  if (!record) {
    throw new NotFoundError(`Model "${modelId}" not found on this connection.`);
  }
  return record;
}

const DETAIL_KEYS = [
  "contextWindow",
  "maxOutputTokens",
  "inputPricePerMTok",
  "outputPricePerMTok",
] as const;

/** Edits a model's details, limits and budget. */
export async function updateConnectionModel(
  id: string,
  modelId: string,
  patch: ModelRecordPatch,
): Promise<ModelRecord> {
  return mutateConnection(id, (c) => {
    const record = findModel(c, modelId);
    for (const key of DETAIL_KEYS) {
      const value = patch[key];
      if (value === null) delete record[key];
      else if (value !== undefined) record[key] = value;
    }
    if (patch.limits) record.limits = { ...patch.limits };
    if (patch.budget) record.budget = { perDay: { ...patch.budget.perDay } };
    return record;
  });
}

export async function removeConnectionModel(
  id: string,
  modelId: string,
): Promise<void> {
  await mutateConnection(id, (c) => {
    findModel(c, modelId);
    c.models = c.models.filter((m) => m.modelId !== modelId);
  });
}
