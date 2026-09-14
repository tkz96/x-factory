// src/settings.ts — Local configuration engine for issue trackers and models using YAGNI & DRY.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface GitHubConfig {
  token?: string;
  repo?: string;
}

export interface JiraConfig {
  host?: string;
  email?: string;
  token?: string;
  project?: string;
}

export interface AzureConfig {
  orgUrl?: string;
  project?: string;
  pat?: string;
}

export interface ModelStageConfig {
  provider?: string;
  model?: string;
}

export interface ModelConfig {
  sessionA?: ModelStageConfig;
  sessionB?: ModelStageConfig;
}

export interface FactorySettings {
  activeTracker: "github" | "jira" | "azure";
  theme?: "dark" | "light";
  github?: GitHubConfig;
  jira?: JiraConfig;
  azure?: AzureConfig;
  models?: ModelConfig;
}

const DEFAULT_SETTINGS: FactorySettings = {
  activeTracker: "github",
  theme: "dark",
  github: {},
  jira: {},
  azure: {},
  models: {
    sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
    sessionB: { provider: "anthropic", model: "claude-3-7-sonnet" },
  },
};

function getSettingsFilePath(): string {
  return (
    process.env.XF_SETTINGS_PATH ||
    path.join(os.homedir(), ".x-factory", "settings.json")
  );
}


export function maskSecret(val?: string): string {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function isMasked(val?: string): boolean {
  return typeof val === "string" && (val.includes("••••") || val.includes("****"));
}

export function maskSettings(settings: FactorySettings): FactorySettings {
  return {
    ...settings,
    github: {
      ...settings.github,
      token: maskSecret(settings.github?.token),
    },
    jira: {
      ...settings.jira,
      token: maskSecret(settings.jira?.token),
    },
    azure: {
      ...settings.azure,
      pat: maskSecret(settings.azure?.pat),
    },
  };
}

/**
 * Load settings from disk. Returns default settings if missing.
 */
export async function loadSettings(masked = false): Promise<FactorySettings> {
  const filePath = getSettingsFilePath();
  let current: FactorySettings = { ...DEFAULT_SETTINGS };

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FactorySettings>;
    current = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      github: { ...DEFAULT_SETTINGS.github, ...parsed.github },
      jira: { ...DEFAULT_SETTINGS.jira, ...parsed.jira },
      azure: { ...DEFAULT_SETTINGS.azure, ...parsed.azure },
      models: {
        sessionA: { ...DEFAULT_SETTINGS.models?.sessionA, ...parsed.models?.sessionA },
        sessionB: { ...DEFAULT_SETTINGS.models?.sessionB, ...parsed.models?.sessionB },
      },
    };
  } catch {
    // Return defaults when file doesn't exist
  }

  return masked ? maskSettings(current) : current;
}

/**
 * Save settings to disk with safe file permissions (0600).
 * Preserves unmasked tokens if incoming values contain mask characters.
 */
export async function saveSettings(
  patch: Partial<FactorySettings>
): Promise<FactorySettings> {
  const filePath = getSettingsFilePath();
  const existing = await loadSettings(false);

  // Preserve existing secrets if masked in incoming patch
  const githubToken = isMasked(patch.github?.token)
    ? existing.github?.token
    : patch.github?.token?.trim();

  const jiraToken = isMasked(patch.jira?.token)
    ? existing.jira?.token
    : patch.jira?.token?.trim();

  const azurePat = isMasked(patch.azure?.pat)
    ? existing.azure?.pat
    : patch.azure?.pat?.trim();

  const updated: FactorySettings = {
    activeTracker: patch.activeTracker || existing.activeTracker || "github",
    theme: patch.theme || existing.theme || "dark",
    github: {
      ...existing.github,
      ...patch.github,
      token: githubToken,
    },
    jira: {
      ...existing.jira,
      ...patch.jira,
      token: jiraToken,
    },
    azure: {
      ...existing.azure,
      ...patch.azure,
      pat: azurePat,
    },
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
