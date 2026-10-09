// src/settings.ts — Local configuration engine for models and theme using YAGNI & DRY.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSettingsPath } from "./paths.js";

interface ModelStageConfig {
  provider?: string | undefined;
  model?: string | undefined;
}

interface ModelConfig {
  sessionA?: ModelStageConfig | undefined;
  sessionB?: ModelStageConfig | undefined;
}

export interface FactorySettings {
  theme?: ("dark" | "light") | undefined;
  models?: ModelConfig | undefined;
}

// Default settings applied on initial startup. Provider and model pairs
// are fully user-configurable via the Settings UI or environment variables.
const DEFAULT_SETTINGS: FactorySettings = {
  theme: "dark",
  models: {
    sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
    sessionB: { provider: "anthropic", model: "claude-3-7-sonnet" },
  },
};

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
      models: {
        sessionA: {
          ...DEFAULT_SETTINGS.models?.sessionA,
          ...parsed.models?.sessionA,
        },
        sessionB: {
          ...DEFAULT_SETTINGS.models?.sessionB,
          ...parsed.models?.sessionB,
        },
      },
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

  const updated: FactorySettings = {
    theme: patch.theme || existing.theme || "dark",
    models: {
      sessionA: {
        ...existing.models?.sessionA,
        ...patch.models?.sessionA,
      },
      sessionB: {
        ...existing.models?.sessionB,
        ...patch.models?.sessionB,
      },
    },
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(updated, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  return maskSettings(updated);
}
