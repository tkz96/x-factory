// src/project-env.ts — Per-project secret environment variable management.

import { readFile, writeFile } from "node:fs/promises";
import { ensureDir, getProjectDir, getProjectEnvPath } from "./paths.js";

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
 * Writes the complete secret set for a project to its env file.
 */
async function writeProjectEnv(
  projectId: string,
  vars: Record<string, string>,
): Promise<void> {
  await ensureDir(getProjectDir(projectId));
  const envPath = getProjectEnvPath(projectId);
  await writeFile(envPath, formatEnvContent(vars), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Save or update environment secrets for a specific project.
 * Merges with existing secrets, preserving unmasked values.
 * Idempotent: re-applying the same values (a retry) is safe.
 */
export async function saveProjectEnv(
  projectId: string,
  vars: Record<string, string>,
): Promise<void> {
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

  await writeProjectEnv(projectId, updated);
}

/**
 * Removes named secret keys for a project. Used by the explicit `clearSecrets`
 * update contract: an empty value never means delete (#131).
 */
export async function deleteProjectEnvKeys(
  projectId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const updated = await loadProjectEnv(projectId);
  for (const key of keys) {
    delete updated[key];
  }
  await writeProjectEnv(projectId, updated);
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
