// src/azure/auth.ts — Shared Azure DevOps authentication and CLI token resolution.

/**
 * Format an Azure DevOps Personal Access Token (PAT) or OAuth token into an HTTP Authorization header.
 */
export function formatAzureAuthHeader(pat: string): string {
  const trimmed = pat.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("eyJ")
    ? `Bearer ${trimmed}`
    : `Basic ${Buffer.from(`:${trimmed}`).toString("base64")}`;
}

export type CliCommandExecutor = (
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ passed: boolean; stdout: string }>;

/**
 * Retrieve an Azure DevOps OAuth Bearer token from an active Azure CLI session.
 * Exits immediately in test environments unless a custom executor is injected.
 */
export async function getAzureCliAuthHeader(
  executor?: CliCommandExecutor,
): Promise<string> {
  if (process.env.NODE_ENV === "test" && !executor) return "";
  try {
    const exec = executor || (await import("../proc.js")).execCommand;
    const res = await exec(
      "az",
      [
        "account",
        "get-access-token",
        "--resource",
        "499b84ac-1321-427f-aa17-267ca6975798",
        "--query",
        "accessToken",
        "-o",
        "tsv",
      ],
      { timeoutMs: 3500 },
    );
    if (res.passed && res.stdout.trim()) {
      return `Bearer ${res.stdout.trim()}`;
    }
  } catch {
    // az CLI not available or not logged in
  }
  return "";
}

/**
 * Resolve an Authorization header from an explicit PAT or the active Azure CLI session.
 */
export async function resolveAzureAuthHeader(
  pat?: string,
  executor?: CliCommandExecutor,
): Promise<string> {
  if (pat?.trim()) {
    return formatAzureAuthHeader(pat);
  }
  return getAzureCliAuthHeader(executor);
}
