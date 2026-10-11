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
import { detectLegacyKeyProvider } from "./env-bootstrap.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { getModelConnectionsPath, getModelSecretsPath } from "./paths.js";

export const MODEL_API_TYPES = [
  "openai-compatible",
  "gemini",
  "anthropic",
] as const;
export type ModelApiType = (typeof MODEL_API_TYPES)[number];

/** Base URLs pre-filled for API types with one well-known endpoint. */
export const DEFAULT_BASE_URLS: Readonly<
  Record<Exclude<ModelApiType, "openai-compatible">, string>
> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com",
};

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
}

interface ConnectionsFile {
  connections: StoredConnection[];
  /** Set once the first-launch LLM_API_KEY import has run, whatever its outcome. */
  legacyKeyImported?: boolean;
}

type SecretsFile = Record<string, string>;

/** A connection as returned to callers: never the key itself. */
export interface ModelConnectionView extends StoredConnection {
  hasKey: boolean;
  keyLast4: string | null;
  /** Where the effective key comes from. */
  keySource: "stored" | "environment" | "none";
}

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

const readConnections = () =>
  readJson<ConnectionsFile>(getModelConnectionsPath(), { connections: [] });
const readSecrets = () => readJson<SecretsFile>(getModelSecretsPath(), {});

function envKey(apiType: ModelApiType): string | undefined {
  const value = process.env[KEY_ENV_VARS[apiType]]?.trim();
  return value ? value : undefined;
}

function toView(
  connection: StoredConnection,
  secrets: SecretsFile,
): ModelConnectionView {
  const stored = secrets[connection.id];
  const fromEnv = envKey(connection.apiType);
  const effective = fromEnv ?? stored;
  return {
    ...connection,
    hasKey: Boolean(effective),
    keyLast4: effective ? effective.slice(-4) : null,
    keySource: fromEnv ? "environment" : stored ? "stored" : "none",
  };
}

function resolveBaseUrl(apiType: ModelApiType, baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (trimmed) return trimmed;
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
  return envKey(connection.apiType) ?? (await readSecrets())[id];
}

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
    const apiType: ModelApiType =
      provider === "openai" ? "openai-compatible" : provider;
    imported = await createModelConnection({
      name:
        provider === "gemini"
          ? "Gemini (imported)"
          : provider === "anthropic"
            ? "Anthropic (imported)"
            : "OpenAI (imported)",
      apiType,
      baseUrl:
        apiType === "openai-compatible"
          ? "https://api.openai.com/v1"
          : undefined,
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
