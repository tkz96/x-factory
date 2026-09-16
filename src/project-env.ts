// src/project-env.ts — Per-project secret environment variable management.

import { readFile, writeFile } from "node:fs/promises";
import { ensureDir, getProjectDir, getProjectEnvPath } from "./paths.js";

export const PROJECT_ENV_KEYS = {
  AZURE_PAT: "AZURE_DEVOPS_PAT",
  GITHUB_TOKEN: "GITHUB_TOKEN",
  JIRA_TOKEN: "JIRA_API_TOKEN",
} as const;

/**
 * Parse lines of a .env file into key-value pairs.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Format key-value pairs into .env file content.
 */
export function formatEnvContent(vars: Record<string, string>): string {
  const lines: string[] = [
    "# X-Factory per-project secrets — do not commit to version control",
  ];
  for (const [key, val] of Object.entries(vars)) {
    if (!key) continue;
    // Quote value if it contains spaces, newlines, or quotes
    const needsQuotes = /[\s"'=]/.test(val);
    const formattedVal = needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val;
    lines.push(`${key}=${formattedVal}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Load environment secrets for a specific project.
 */
export async function loadProjectEnv(
  projectId: string,
): Promise<Record<string, string>> {
  const envPath = getProjectEnvPath(projectId);
  try {
    const content = await readFile(envPath, "utf-8");
    return parseEnvContent(content);
  } catch {
    return {};
  }
}

/**
 * Save or update environment secrets for a specific project.
 * Merges with existing secrets, preserving unmasked values.
 */
export async function saveProjectEnv(
  projectId: string,
  vars: Record<string, string>,
): Promise<void> {
  await ensureDir(getProjectDir(projectId));
  const existing = await loadProjectEnv(projectId);

  const updated: Record<string, string> = { ...existing };
  for (const [key, val] of Object.entries(vars)) {
    if (val === undefined || val === null) continue;
    const trimmed = val.trim();
    // If masked, keep existing secret
    if (trimmed.includes("••••") || trimmed.includes("****")) {
      continue;
    }
    if (trimmed === "") {
      delete updated[key];
    } else {
      updated[key] = trimmed;
    }
  }

  const envPath = getProjectEnvPath(projectId);
  const content = formatEnvContent(updated);
  await writeFile(envPath, content, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Convenience helper to get a specific secret for a project.
 */
export async function getProjectSecret(
  projectId: string,
  key: string,
): Promise<string | undefined> {
  const env = await loadProjectEnv(projectId);
  return env[key] || process.env[key] || undefined;
}
