export function matchAzureRemote(trimmed: string): string | null {
  // Azure DevOps SSH: git@ssh.dev.azure.com:v3/org/project/repo
  const azSsh = trimmed.match(
    /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
  );
  if (azSsh?.[1] && azSsh[2] && azSsh[3]) {
    return `azure:${azSsh[1].toLowerCase()}/${azSsh[2].toLowerCase()}/${azSsh[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  // Azure DevOps HTTPS: https://(user@)?dev.azure.com/org/project/_git/repo
  const azHttps = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azHttps?.[1] && azHttps[2] && azHttps[3]) {
    return `azure:${azHttps[1].toLowerCase()}/${azHttps[2].toLowerCase()}/${azHttps[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  // Azure DevOps VisualStudio: https://(user@)?org.visualstudio.com/project/_git/repo
  const azVs = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azVs?.[1] && azVs[2] && azVs[3]) {
    return `azure:${azVs[1].toLowerCase()}/${azVs[2].toLowerCase()}/${azVs[3].replace(/\.git$/, "").toLowerCase()}`;
  }

  return null;
}

export function matchGitHubRemote(trimmed: string): string | null {
  const ghMatch = trimmed.match(
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:git@)?github\.com:)([^/]+)\/([^/]+)/i,
  );
  if (ghMatch?.[1] && ghMatch[2]) {
    return `github:${ghMatch[1].toLowerCase()}/${ghMatch[2].replace(/\.git$/, "").toLowerCase()}`;
  }
  return null;
}

export function cleanGenericRemote(trimmed: string): string {
  return trimmed
    .replace(/^(?:https?|ssh|git):\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:/g, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function normalizeGitRemoteUrl(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  return (
    matchAzureRemote(trimmed) ||
    matchGitHubRemote(trimmed) ||
    cleanGenericRemote(trimmed)
  );
}
