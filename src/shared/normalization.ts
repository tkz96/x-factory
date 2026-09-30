// src/shared/normalization.ts

export function normalizeProjectId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeAzureOrganization(url: string): string {
  try {
    let lower = url.toLowerCase().trim();
    if (!lower.startsWith("http")) {
      lower = `https://${lower}`;
    }
    const parsed = new URL(lower);
    // Remove trailing slashes and common dev.azure.com path normalization
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, "");
  }
}

export function normalizeAzureProject(name: string): string {
  return name.toLowerCase().trim();
}

export function normalizeGitHubRepository(repo: string): string {
  return repo.toLowerCase().trim();
}
