// src/frontend/lib/docs-location.ts — Which document the Docs screen shows,
// read from the URL. One default per category: a missing slug never borrows
// the slug of another category (#325).

export const SECURITY_SLUGS = [
  "least-privilege",
  "azure",
  "github",
  "gitlab",
  "jira",
] as const;

const DEFAULT_CATEGORY = "tutorials";

/** The document a category opens with when the URL names none. */
const DEFAULT_SLUGS: Readonly<Record<string, string>> = {
  tutorials: "first-agent-run",
  security: "least-privilege",
};

export interface DocsLocation {
  category: string;
  slug: string;
}

export function resolveDocsLocation(params: URLSearchParams): DocsLocation {
  const category = params.get("cat") || DEFAULT_CATEGORY;
  const slug = params.get("slug") || DEFAULT_SLUGS[category] || "";
  if (
    category === "security" &&
    !(SECURITY_SLUGS as readonly string[]).includes(slug)
  ) {
    return { category, slug: DEFAULT_SLUGS.security as string };
  }
  return { category, slug };
}
