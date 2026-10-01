export function matchAzureRemote(trimmed: string): string | null {
  // Azure DevOps SSH: git@ssh.dev.azure.com:v3/org/project/repo
  const azSsh = trimmed.match(
    /^(?:(?:git@|ssh:\/\/git@))?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
  );
  if (azSsh?.[1] && azSsh[2] && azSsh[3]) {
    const org = azSsh[1].toLowerCase();
    const proj = azSsh[2].toLowerCase();
    const repo = azSsh[3]
      .replace(/\.git\/?$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `azure:${org}/${proj}/${repo}`;
  }

  // Azure DevOps HTTPS: https://(user@)?dev.azure.com/org/project/_git/repo
  const azHttps = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azHttps?.[1] && azHttps[2] && azHttps[3]) {
    const org = azHttps[1].toLowerCase();
    const proj = azHttps[2].toLowerCase();
    const repo = azHttps[3]
      .replace(/\.git\/?$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `azure:${org}/${proj}/${repo}`;
  }

  // Azure DevOps VisualStudio: https://(user@)?org.visualstudio.com/project/_git/repo
  const azVs = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/|\/)([^/]+)/i,
  );
  if (azVs?.[1] && azVs[2] && azVs[3]) {
    const org = azVs[1].toLowerCase();
    const proj = azVs[2].toLowerCase();
    const repo = azVs[3]
      .replace(/\.git\/?$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `azure:${org}/${proj}/${repo}`;
  }

  return null;
}

export function matchGitHubRemote(trimmed: string): string | null {
  const ghMatch = trimmed.match(
    /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/|(?:git@)?github\.com:)([^/]+)\/([^/]+)/i,
  );
  if (ghMatch?.[1] && ghMatch[2]) {
    const owner = ghMatch[1].toLowerCase();
    const repo = ghMatch[2]
      .replace(/\.git\/?$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `github:${owner}/${repo}`;
  }
  return null;
}

export function cleanGenericRemote(trimmed: string): string {
  return trimmed
    .replace(/^(?:https?|ssh|git):\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:/g, "/")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function normalizeGitRemoteUrl(url?: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  return (
    matchAzureRemote(trimmed) ||
    matchGitHubRemote(trimmed) ||
    cleanGenericRemote(trimmed)
  );
}
