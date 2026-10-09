// src/settings.ts — Local configuration engine for models and theme using YAGNI & DRY.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSettingsPath } from "./paths.js";
import type { WorkbenchSettings } from "./shared/types.js";

// The file format and the wire format are one contract, declared once in the
// shared module (#182): settings.json, GET /api/settings and POST /api/settings
// are all `WorkbenchSettings`.
export type FactorySettings = WorkbenchSettings;

// Default settings applied on initial startup. Provider and model pairs
// are fully user-configurable via the Settings UI or environment variables.
const DEFAULT_SETTINGS: FactorySettings = {
  theme: "dark",
  models: {
    sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
    sessionB: { provider: "anthropic", model: "claude-3-7-sonnet" },
  },
};

/** One session's model pair, as stored once normalized (#182). */
type ModelEntry = { provider?: string | undefined; model?: string | undefined };

/**
 * Normalize one settings.json model entry to the {provider, model} contract
 * (#182). Legacy files can hold a bare model string — the old settings form
 * posted scalars the server spread into the file — or an object whose model
 * string was spread into character-index keys ("0": "g", "1": "p", …). A
 * string becomes the model with the default provider; index keys are rebuilt
 * into the model string they spell when no model is set, then dropped, because
 * only `{provider, model}` is ever read back out.
 */
function normalizeModelEntry(raw: unknown, fallback?: ModelEntry): ModelEntry {
  if (typeof raw === "string") {
    const model = raw.trim();
    return model ? { provider: fallback?.provider, model } : { ...fallback };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const provider =
      typeof record.provider === "string" && record.provider.trim()
        ? record.provider.trim()
        : fallback?.provider;
    let model =
      typeof record.model === "string" && record.model.trim()
        ? record.model.trim()
        : undefined;
    if (model === undefined) {
      model =
        Object.keys(record)
          .filter((key) => /^\d+$/.test(key))
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => record[key])
          .filter((ch) => typeof ch === "string")
          .join("") || undefined;
    }
    return { provider, model: model ?? fallback?.model };
  }
  return { ...fallback };
}

/** The normalized model entries of a settings.json payload, one per session. */
function normalizeModels(raw: unknown): {
  sessionA: ModelEntry;
  sessionB: ModelEntry;
} {
  const models =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    sessionA: normalizeModelEntry(
      models.sessionA,
      DEFAULT_SETTINGS.models?.sessionA,
    ),
    sessionB: normalizeModelEntry(
      models.sessionB,
      DEFAULT_SETTINGS.models?.sessionB,
    ),
  };
}

export function maskSecret(val?: string): string {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function isMasked(val?: string): boolean {
  return (
    typeof val === "string" && (val.includes("••••") || val.includes("****"))
  );
}

export function maskSettings(settings: FactorySettings): FactorySettings {
  return { ...settings };
}

/**
 * Load settings from disk. Returns default settings if missing.
 */
export async function loadSettings(masked = false): Promise<FactorySettings> {
  const filePath = getSettingsPath();
  let current: FactorySettings = { ...DEFAULT_SETTINGS };

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FactorySettings>;
    current = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      models: normalizeModels(parsed.models),
    };
  } catch {
    // Return defaults when file doesn't exist
  }

  return masked ? maskSettings(current) : current;
}

/**
 * Save settings to disk with safe file permissions (0600).
 */
export async function saveSettings(
  patch: Partial<FactorySettings>,
): Promise<FactorySettings> {
  const filePath = getSettingsPath();
  const existing = await loadSettings(false);

  // The file format is the {provider, model} contract (#182): the merged entry
  // is normalized on the way out, so legacy index keys can never be re-spread
  // into a saved file.
  const updated: FactorySettings = {
    theme: patch.theme || existing.theme || "dark",
    models: normalizeModels({
      sessionA: { ...existing.models?.sessionA, ...patch.models?.sessionA },
      sessionB: { ...existing.models?.sessionB, ...patch.models?.sessionB },
    }),
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(updated, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  return maskSettings(updated);
}
