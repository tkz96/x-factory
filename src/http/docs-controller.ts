// src/http/docs-controller.ts — In-app Diátaxis documentation REST endpoints (XFM-53).

import path from "node:path";
import { errorResponse, jsonResponse } from "./responses.js";

export interface DocMetadata {
  slug: string;
  title: string;
  description: string;
  path: string;
}

export interface DocCategory {
  id: string;
  name: string;
  description: string;
  docs: DocMetadata[];
}

export const DOC_CATALOG: DocCategory[] = [
  {
    id: "tutorials",
    name: "Tutorials",
    description: "Learning-oriented step-by-step guides for newcomers",
    docs: [
      {
        slug: "first-agent-run",
        title: "Run Your First Agent Workflow",
        description:
          "A step-by-step lesson to start the server, launch a worker, and execute your first workflow run.",
        path: "docs/tutorials/first-agent-run.md",
      },
    ],
  },
  {
    id: "how-to",
    name: "How-To Guides",
    description: "Goal-oriented procedures for specific operational tasks",
    docs: [
      {
        slug: "verify-worker-and-pi-session",
        title: "How to Verify Worker Leases and Agent Sessions",
        description:
          "Step-by-step verification procedure for worker claiming, database inspection, and Server-Sent Events.",
        path: "docs/how-to/verify-worker-and-pi-session.md",
      },
      {
        slug: "backup-and-restore-database",
        title: "How to Back Up and Restore the Database",
        description:
          "Procedures for non-blocking SQLite snapshots, artifact archives, cron automation, and disaster recovery.",
        path: "docs/how-to/backup-and-restore-database.md",
      },
    ],
  },
  {
    id: "reference",
    name: "Reference",
    description: "Factual technical descriptions, specifications, and schemas",
    docs: [
      {
        slug: "database-schema",
        title: "Database Schema and Durable Entities",
        description:
          "SQLite table definitions, columns, constraints, connection PRAGMAs, and runtime entity rules.",
        path: "docs/reference/database-schema.md",
      },
      {
        slug: "state-machine-matrix",
        title: "Workflow State Machine and Transition Contracts",
        description:
          "State definitions, the 11×11 state transition matrix, transition triggers, and monotonic execution rules.",
        path: "docs/reference/state-machine-matrix.md",
      },
      {
        slug: "production-readiness-checklist",
        title: "Production Readiness Checklist and Evaluation Criteria",
        description:
          "System verification standards across the twelve production pillars.",
        path: "docs/reference/production-readiness-checklist.md",
      },
    ],
  },
  {
    id: "explanation",
    name: "Explanation",
    description:
      "Conceptual architecture, design decisions, and system mechanics",
    docs: [
      {
        slug: "process-boundaries-and-topology",
        title: "Process Boundaries and System Topology",
        description:
          "Conceptual analysis of API and Worker separation, SQLite Write-Ahead Logging, and worker lease lifecycles.",
        path: "docs/explanation/process-boundaries-and-topology.md",
      },
      {
        slug: "ui-state-and-event-streaming",
        title: "UI State Management and Real-Time Event Streaming",
        description:
          "Technical rationale for Server-Sent Events, event bus dispatching, historical replay, and optimistic concurrency.",
        path: "docs/explanation/ui-state-and-event-streaming.md",
      },
    ],
  },
];

export interface DocSearchMatch {
  heading: string;
  headingId: string;
  snippet: string;
  matchCount: number;
}

export interface DocSearchResult {
  category: string;
  categoryName: string;
  slug: string;
  title: string;
  totalMatches: number;
  sections: DocSearchMatch[];
}

export interface DocsSearchResponse {
  query: string;
  totalMatches: number;
  results: DocSearchResult[];
}

interface IndexedSection {
  heading: string;
  headingId: string;
  content: string;
}

interface IndexedDoc {
  category: string;
  categoryName: string;
  slug: string;
  title: string;
  description: string;
  sections: IndexedSection[];
}

const SECURITY_DOCS: Array<{
  slug: string;
  title: string;
  description: string;
  sections: Array<{ heading: string; headingId: string; content: string }>;
}> = [
  {
    slug: "least-privilege",
    title: "Principle of Least Privilege",
    description:
      "Security architecture and credential scoping guidelines for automated AI runs.",
    sections: [
      {
        heading: "Principle of Least Privilege",
        headingId: "least-privilege-overview",
        content:
          "Principle of Least Privilege: Every pipeline step executes in an ephemeral workspace with minimum required tokens and non-root isolation.",
      },
      {
        heading: "Security Guardrail",
        headingId: "least-privilege-guardrail",
        content:
          "Security Guardrail: Worker processes run under non-root permissions and validate token expiration before executing stages.",
      },
    ],
  },
  {
    slug: "azure",
    title: "Azure DevOps Token Scopes",
    description:
      "Required Personal Access Token scopes for Azure DevOps repositories and work items.",
    sections: [
      {
        heading: "Azure DevOps Token Scopes",
        headingId: "azure-pat-scopes",
        content:
          "Azure DevOps Token Scopes: Work Items: Read, Code: Read & write, Code: Status for PR creation and backlog tracking.",
      },
      {
        heading: "Required Scopes",
        headingId: "azure-required-scopes",
        content:
          "Required Scopes: Work Items: Read (Fetch backlog tickets and acceptance criteria), Code: Read & write (Clone repo, push implementation branch, open PR), Code: Status (Post commit statuses and PR verification checks).",
      },
    ],
  },
  {
    slug: "github",
    title: "GitHub Personal Access Token",
    description:
      "Required scopes for GitHub PATs when interacting with repositories and pull requests.",
    sections: [
      {
        heading: "GitHub Personal Access Token",
        headingId: "github-pat",
        content:
          "GitHub Personal Access Token scopes: repo (Full control of private repositories, issues, PRs), workflow (Update GitHub Actions workflow files if modifying CI), pull_requests:write (Create and update pull requests).",
      },
    ],
  },
  {
    slug: "gitlab",
    title: "GitLab Access Token",
    description:
      "Required permissions for GitLab project access tokens and merge requests.",
    sections: [
      {
        heading: "GitLab Access Token",
        headingId: "gitlab-pat",
        content:
          "GitLab Access Token scopes: read_api (Query project metadata, issues, and pipelines), write_repository (Push branches and create merge requests).",
      },
    ],
  },
  {
    slug: "jira",
    title: "Atlassian Jira API Token",
    description: "Required permissions for Jira Cloud REST API authentication.",
    sections: [
      {
        heading: "Atlassian Jira API Token",
        headingId: "jira-token",
        content:
          "Atlassian Jira API Token scopes: read:jira-work (Read issues, sprint boards, and project settings), write:jira-work (Update issue status, add comments, and transition tickets).",
      },
    ],
  },
];

export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*`_#]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function parseMarkdownSections(
  markdown: string,
  docTitle: string,
): IndexedSection[] {
  const sections: IndexedSection[] = [];
  const lines = markdown.split("\n");

  let currentHeading = docTitle;
  let currentHeadingId = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("# ") ||
      trimmed.startsWith("## ") ||
      trimmed.startsWith("### ")
    ) {
      if (currentLines.length > 0 || currentHeadingId) {
        sections.push({
          heading: currentHeading,
          headingId: currentHeadingId,
          content: currentLines.join(" "),
        });
        currentLines = [];
      }
      const rawText = trimmed.replace(/^#+\s+/, "");
      currentHeading = rawText.replace(/[*`_#]/g, "").trim();
      currentHeadingId = headingSlug(rawText);
    } else {
      const cleanLine = trimmed
        .replace(/[*`_]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
      if (cleanLine) {
        currentLines.push(cleanLine);
      }
    }
  }

  if (currentLines.length > 0 || currentHeadingId) {
    sections.push({
      heading: currentHeading,
      headingId: currentHeadingId,
      content: currentLines.join(" "),
    });
  }

  return sections;
}

let cachedIndex: IndexedDoc[] | null = null;

export function clearDocSearchCache(): void {
  cachedIndex = null;
}

export async function getOrBuildSearchIndex(): Promise<IndexedDoc[]> {
  if (cachedIndex) {
    return cachedIndex;
  }

  const docsRoot = path.resolve(process.cwd(), "docs");
  const indexedDocs: IndexedDoc[] = [];

  for (const category of DOC_CATALOG) {
    for (const doc of category.docs) {
      const filePath = path.normalize(
        path.join(docsRoot, category.id, `${doc.slug}.md`),
      );
      const file = Bun.file(filePath);
      let content = "";
      if (await file.exists()) {
        content = await file.text();
      }

      const sections = parseMarkdownSections(content, doc.title);
      indexedDocs.push({
        category: category.id,
        categoryName: category.name,
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        sections,
      });
    }
  }

  // Index security topics
  for (const sec of SECURITY_DOCS) {
    indexedDocs.push({
      category: "security",
      categoryName: "Credentials & Scopes",
      slug: sec.slug,
      title: sec.title,
      description: sec.description,
      sections: sec.sections,
    });
  }

  cachedIndex = indexedDocs;
  return indexedDocs;
}

function countOccurrences(text: string, lowerQuery: string): number {
  if (!text || !lowerQuery) return 0;
  const lowerText = text.toLowerCase();
  let count = 0;
  let pos = lowerText.indexOf(lowerQuery, 0);
  while (pos !== -1) {
    count++;
    pos = lowerText.indexOf(lowerQuery, pos + lowerQuery.length);
  }
  return count;
}

function extractSnippet(text: string, lowerQuery: string, maxLen = 85): string {
  if (!text) return "";
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) {
    return text.length > maxLen ? `${text.slice(0, maxLen).trim()}…` : text;
  }

  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + lowerQuery.length + 45);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

export async function searchDocIndex(
  rawQuery: string,
): Promise<DocsSearchResponse> {
  const query = rawQuery.trim();
  if (query.length < 2) {
    return { query, totalMatches: 0, results: [] };
  }

  const index = await getOrBuildSearchIndex();
  const lowerQuery = query.toLowerCase();
  const results: DocSearchResult[] = [];
  let grandTotalMatches = 0;

  for (const doc of index) {
    const docTitleMatches = countOccurrences(doc.title, lowerQuery);
    const docDescMatches = countOccurrences(doc.description, lowerQuery);
    let docMatchesCount = docTitleMatches + docDescMatches;
    const matchingSections: DocSearchMatch[] = [];

    for (const sec of doc.sections) {
      const headingMatches = countOccurrences(sec.heading, lowerQuery);
      const contentMatches = countOccurrences(sec.content, lowerQuery);
      const totalSecMatches = headingMatches + contentMatches;

      if (totalSecMatches > 0) {
        docMatchesCount += totalSecMatches;
        const snippet = extractSnippet(sec.content || sec.heading, lowerQuery);
        matchingSections.push({
          heading: sec.heading,
          headingId: sec.headingId,
          snippet,
          matchCount: totalSecMatches,
        });
      }
    }

    if (docMatchesCount > 0) {
      if (matchingSections.length === 0) {
        matchingSections.push({
          heading: doc.title,
          headingId: "",
          snippet: doc.description,
          matchCount: docMatchesCount,
        });
      }

      matchingSections.sort((a, b) => b.matchCount - a.matchCount);
      const cappedSections = matchingSections.slice(0, 4);

      grandTotalMatches += docMatchesCount;
      results.push({
        category: doc.category,
        categoryName: doc.categoryName,
        slug: doc.slug,
        title: doc.title,
        totalMatches: docMatchesCount,
        sections: cappedSections,
      });
    }
  }

  results.sort((a, b) => b.totalMatches - a.totalMatches);

  return {
    query,
    totalMatches: grandTotalMatches,
    results,
  };
}

const SAFE_PARAM_REGEX = /^[a-z0-9_-]+$/i;

/**
 * Handles /api/docs routes:
 * - GET /api/docs -> returns category and document catalog
 * - GET /api/docs/search?q=... -> full-text search across documentation index
 * - GET /api/docs/:category/:slug -> returns markdown content for specified document
 */
export async function handleDocsRoute(
  method: string,
  category?: string,
  slug?: string,
  req?: Request,
): Promise<Response> {
  if (method !== "GET") {
    return errorResponse("Method not allowed.", 405);
  }

  // 1. Search endpoint: GET /api/docs/search?q=...
  if (category === "search") {
    const url = req
      ? new URL(req.url)
      : new URL("http://localhost/api/docs/search");
    const query = url.searchParams.get("q") ?? "";
    const searchResults = await searchDocIndex(query);
    return jsonResponse(searchResults);
  }

  // 2. Catalog listing: GET /api/docs
  if (!category) {
    return jsonResponse({ categories: DOC_CATALOG });
  }

  // 3. Specific doc: GET /api/docs/:category/:slug
  if (!slug) {
    return errorResponse("Document slug is required.", 400);
  }

  if (!SAFE_PARAM_REGEX.test(category) || !SAFE_PARAM_REGEX.test(slug)) {
    return errorResponse("Invalid document path parameter.", 400);
  }

  const categoryConfig = DOC_CATALOG.find((c) => c.id === category);
  if (!categoryConfig) {
    return errorResponse(
      `Documentation category "${category}" not found.`,
      404,
    );
  }

  const docMetadata = categoryConfig.docs.find((d) => d.slug === slug);
  if (!docMetadata) {
    return errorResponse(
      `Document "${slug}" not found in category "${category}".`,
      404,
    );
  }

  const docsRoot = path.resolve(process.cwd(), "docs");
  const targetFilePath = path.normalize(
    path.join(docsRoot, category, `${slug}.md`),
  );

  // Path traversal guard
  if (!targetFilePath.startsWith(docsRoot)) {
    return errorResponse("Forbidden document path.", 403);
  }

  const file = Bun.file(targetFilePath);
  if (!(await file.exists())) {
    return errorResponse("Documentation file not found on disk.", 404);
  }

  const markdown = await file.text();

  return jsonResponse({
    category,
    slug,
    title: docMetadata.title,
    description: docMetadata.description,
    markdown,
  });
}
