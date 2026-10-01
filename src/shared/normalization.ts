// src/shared/normalization.ts
export function normalizeProjectId(id: string): string {
  if (!id || typeof id !== "string") return "";
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeAzureOrganization(url: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    let lower = trimmed.toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      lower = `https://${lower}`;
    }
    const parsed = new URL(lower);
    // Remove trailing slashes and common dev.azure.com path normalization
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

export function normalizeAzureProject(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\/+$/, "");
}

export function normalizeGitHubRepository(repo: string): string {
  if (!repo || typeof repo !== "string") return "";
  let trimmed = repo.trim().toLowerCase();
  trimmed = trimmed
    .replace(
      /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:git@)?github\.com:)/i,
      "",
    )
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return trimmed;
}
