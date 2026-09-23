// test/docs-controller.test.ts — Unit tests for In-app Diátaxis documentation endpoints.

import { describe, expect, it } from "bun:test";
import { handleDocsRoute } from "../src/http/docs-controller.js";

describe("Docs Controller (src/http/docs-controller.ts)", () => {
  it("rejects non-GET HTTP methods with 405 Method Not Allowed", async () => {
    const res = await handleDocsRoute("POST");
    expect(res.status).toBe(405);
    const data = await res.json();
    expect(data.error).toBe("Method not allowed.");
  });

  it("returns full document catalog on GET /api/docs without parameters", async () => {
    const res = await handleDocsRoute("GET");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories.length).toBe(4);

    const categoryIds = data.categories.map((c: { id: string }) => c.id);
    expect(categoryIds).toContain("tutorials");
    expect(categoryIds).toContain("how-to");
    expect(categoryIds).toContain("reference");
    expect(categoryIds).toContain("explanation");
  });

  it("returns 400 when category is supplied without slug", async () => {
    const res = await handleDocsRoute("GET", "tutorials");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Document slug is required.");
  });

  it("returns 400 for unsafe parameters with path traversal characters", async () => {
    const res = await handleDocsRoute("GET", "../etc", "passwd");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid document path parameter.");
  });

  it("returns 404 for non-existent category", async () => {
    const res = await handleDocsRoute("GET", "unknown-cat", "some-slug");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('category "unknown-cat" not found');
  });

  it("returns 404 for non-existent slug in valid category", async () => {
    const res = await handleDocsRoute(
      "GET",
      "tutorials",
      "non-existent-tutorial",
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('Document "non-existent-tutorial" not found');
  });

  it("returns markdown content and metadata for valid document", async () => {
    const res = await handleDocsRoute("GET", "tutorials", "first-agent-run");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe("tutorials");
    expect(data.slug).toBe("first-agent-run");
    expect(data.title).toBe("Run Your First Agent Workflow");
    expect(typeof data.markdown).toBe("string");
    expect(data.markdown.length).toBeGreaterThan(50);
  });

  describe("Documentation Full-Text Search (GET /api/docs/search?q=...)", () => {
    it("returns empty results for queries shorter than 2 characters", async () => {
      const req = new Request("http://localhost:3777/api/docs/search?q=a");
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.query).toBe("a");
      expect(data.totalMatches).toBe(0);
      expect(data.results).toEqual([]);
    });

    it("returns empty results when query param is missing", async () => {
      const req = new Request("http://localhost:3777/api/docs/search");
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalMatches).toBe(0);
      expect(data.results).toEqual([]);
    });

    it("searches across Diátaxis docs for 'implementing' with sections and snippets", async () => {
      const req = new Request(
        "http://localhost:3777/api/docs/search?q=implementing",
      );
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.query).toBe("implementing");
      expect(data.totalMatches).toBeGreaterThan(0);
      expect(Array.isArray(data.results)).toBe(true);

      const stateMachineMatch = data.results.find(
        (r: { slug: string }) => r.slug === "state-machine-matrix",
      );
      expect(stateMachineMatch).toBeDefined();
      expect(stateMachineMatch.category).toBe("reference");
      expect(stateMachineMatch.title).toContain("Workflow State Machine");
      expect(stateMachineMatch.sections.length).toBeGreaterThan(0);

      const sectionWithSnippet = stateMachineMatch.sections[0];
      expect(sectionWithSnippet.heading).toBeDefined();
      expect(sectionWithSnippet.snippet.toLowerCase()).toContain(
        "implementing",
      );
      expect(sectionWithSnippet.matchCount).toBeGreaterThan(0);
    });

    it("searches across Credentials & Scopes for 'azure'", async () => {
      const req = new Request("http://localhost:3777/api/docs/search?q=azure");
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalMatches).toBeGreaterThan(0);

      const azureMatch = data.results.find(
        (r: { slug: string }) => r.slug === "azure",
      );
      expect(azureMatch).toBeDefined();
      expect(azureMatch.category).toBe("security");
      expect(azureMatch.title).toBe("Azure DevOps Token Scopes");
      expect(azureMatch.sections.length).toBeGreaterThan(0);
    });

    it("searches for 'PRAGMA' and returns database-schema reference", async () => {
      const req = new Request("http://localhost:3777/api/docs/search?q=pragma");
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalMatches).toBeGreaterThan(0);

      const dbSchemaMatch = data.results.find(
        (r: { slug: string }) => r.slug === "database-schema",
      );
      expect(dbSchemaMatch).toBeDefined();
      expect(dbSchemaMatch.category).toBe("reference");
    });

    it("resets and rebuilds cache via clearDocSearchCache", async () => {
      const { clearDocSearchCache } = await import(
        "../src/http/docs-controller.js"
      );
      clearDocSearchCache();
      const req = new Request(
        "http://localhost:3777/api/docs/search?q=workflow",
      );
      const res = await handleDocsRoute("GET", "search", undefined, req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalMatches).toBeGreaterThan(0);
    });
  });
});
