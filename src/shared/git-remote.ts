// Pure: the single identity of a git remote. HTTPS, scp-style SSH (`git@host:`),
// `ssh://` and trailing-slash forms of one repository all normalize equal, so
// readiness checks and duplicate detection compare the same key. No I/O.

// Azure DevOps SSH: git@ssh.dev.azure.com:v3/org/project/repo, optionally
// written as ssh://git@ssh.dev.azure.com[:port]/v3/org/project/repo.
const AZURE_SSH =
  /^(?:ssh:\/\/)?(?:git@)?ssh\.dev\.azure\.com(?::\d+)?[:/]v3\/([^/]+)\/([^/]+)\/([^/]+)/i;

// Azure DevOps HTTPS: https://(user@)?dev.azure.com/org/project/_git/repo
const AZURE_HTTPS =
  /^(?:https?:\/\/)?(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/|\/)([^/]+)/i;

// Azure DevOps legacy: https://(user@)?org.visualstudio.com/project/_git/repo
const AZURE_VISUAL_STUDIO =
  /^(?:https?:\/\/)?(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/|\/)([^/]+)/i;

const GITHUB =
  /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:git@)?github\.com:)([^/]+)\/([^/]+)/i;

function matchAzureRemote(s: string): string | null {
  const match =
    s.match(AZURE_SSH) || s.match(AZURE_HTTPS) || s.match(AZURE_VISUAL_STUDIO);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return `azure:${match[1]}/${match[2]}/${match[3]}`.toLowerCase();
}

function matchGitHubRemote(s: string): string | null {
  const match = s.match(GITHUB);
  if (!match?.[1] || !match[2]) return null;
  return `github:${match[1]}/${match[2]}`.toLowerCase();
}

// Any other host: drop the scheme, the userinfo and (for URL forms) the port,
// and turn the scp-style `host:path` separator into `/`.
function cleanGenericRemote(s: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;
  const hasScheme = scheme.test(s);
  let rest = s.replace(scheme, "").replace(/^[^@/]+@/, "");
  if (hasScheme) {
    rest = rest.replace(/^([^/:]+):\d+(?=\/)/, "$1");
  } else {
    rest = rest.replace(":", "/");
  }
  return rest.toLowerCase();
}

function stripTrailing(s: string): string {
  return s
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

export function normalizeGitRemoteUrl(url?: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = stripTrailing(url.trim());
  if (!trimmed) return "";
  return (
    matchAzureRemote(trimmed) ||
    matchGitHubRemote(trimmed) ||
    cleanGenericRemote(trimmed)
  );
}
