// test/integration.test.ts — Lightweight integration tests validating server startup, static asset delivery, health check, and core API contracts.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { defaultEventBus } from "../src/events.js";
import { startServer } from "../src/server.js";
import { defaultRunStore } from "../src/store.js";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(async () => {
  // Bind to an ephemeral port for isolated integration testing
  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  if (server) {
    server.stop(true);
  }
});

describe("Integration — Server Lifecycle & Core Contracts", () => {
  describe("Health & Diagnostics", () => {
    it("GET /api/health returns HTTP 200 with operational status", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const body = (await res.json()) as {
        status: string;
        uptime: number;
        version: string;
      };
      expect(body.status).toBe("ok");
      expect(typeof body.uptime).toBe("number");
      expect(body.version).toBe("0.1.0");
    });
  });

  describe("Static Asset Serving", () => {
    it("serves index.html on GET / with app shell elements", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("<title>X-Factory</title>");
      expect(html).toContain('id="app-shell"');
      expect(html).toContain('id="sidebar-nav"');
      expect(html).toContain('src="/app.js"');
    });

    it("serves styles.css on GET /styles.css", async () => {
      const res = await fetch(`${baseUrl}/styles.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/css");

      const css = await res.text();
      expect(css).toContain(":root");
      expect(css.length).toBeGreaterThan(100);
    });

    it("serves bundled client script on GET /app.js", async () => {
      const res = await fetch(`${baseUrl}/app.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain(
        "application/javascript",
      );

      const js = await res.text();
      expect(js.length).toBeGreaterThan(1000);
    });

    it("serves SVG favicon on GET /favicon.svg", async () => {
      const res = await fetch(`${baseUrl}/favicon.svg`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    });

    it("serves fonts on GET /fonts/Inter-Regular.woff2", async () => {
      const res = await fetch(`${baseUrl}/fonts/Inter-Regular.woff2`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("font/woff2");
    });

    it("blocks directory traversal with 403 Forbidden", async () => {
      const res = await fetch(`${baseUrl}/%2e%2e/%2e%2e/package.json`);
      expect([403, 404]).toContain(res.status);
    });

    it("returns 404 for unknown static file", async () => {
      const res = await fetch(`${baseUrl}/non-existent-asset.xyz`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for missing .js files without falling back to source in production", async () => {
      const res = await fetch(`${baseUrl}/missing-script.js`);
      expect(res.status).toBe(404);
    });
  });

  describe("Core API Contracts", () => {
    it("GET /api/projects returns list of projects", async () => {
      const res = await fetch(`${baseUrl}/api/projects`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const projects = (await res.json()) as Array<{
        id: string;
        name: string;
      }>;
      expect(Array.isArray(projects)).toBe(true);
      if (projects.length > 0) {
        expect(projects[0]).toHaveProperty("id");
        expect(projects[0]).toHaveProperty("name");
      }
    });

    it("GET /api/settings returns masked system settings", async () => {
      const res = await fetch(`${baseUrl}/api/settings`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const settings = (await res.json()) as Record<string, unknown>;
      expect(settings).toBeDefined();
    });

    it("GET /api/runs returns active runs list", async () => {
      const res = await fetch(`${baseUrl}/api/runs`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const runs = await res.json();
      expect(Array.isArray(runs)).toBe(true);
    });

    it("POST /api/runs rejects malformed request body with 400", async () => {
      const res = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json",
      });
      expect(res.status).toBe(400);
    });

    it("GET /api/runs/:id returns 404 for non-existent run", async () => {
      const res = await fetch(`${baseUrl}/api/runs/non-existent-run-999`);
      expect(res.status).toBe(404);
    });
  });

  describe("SSE Event Streaming", () => {
    const runId = "test-integration-sse-run";

    beforeAll(() => {
      defaultRunStore.set(runId, {
        id: runId,
        project: { id: "p1", name: "Test Project" },
        ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
        plan: "Test Plan",
        branch: "factory/t-1",
        status: "implementing",
        events: [
          { type: "info", text: "Initial run event", timestamp: Date.now() },
        ],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        implementationContext: null,
        verification: null,
        review: null,
        artifacts: [],
        diff: null,
        pullRequest: null,
        repairAttempts: 0,
        artifactsDir: "/tmp",
        worktreePath: "/tmp",
        _session: null,
        _baseline: null,
        _project: {
          id: "p1",
          name: "Test Project",
          repositoryPath: "/tmp",
          defaultBranch: "main",
          testCommand: "bun test",
          issueTracker: { provider: "github", github: { repo: "test/repo" } },
          repositories: [],
        },
      });
    });

    afterAll(() => {
      defaultRunStore.delete(runId);
    });

    it("GET /api/runs/:id/events returns 200 text/event-stream with initial events", async () => {
      const res = await fetch(`${baseUrl}/api/runs/${runId}/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      expect(res.headers.get("Cache-Control")).toContain("no-cache");

      const reader = res.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) throw new Error("Expected reader to be defined");

      const { value, done } = await reader.read();
      expect(done).toBe(false);

      const text = new TextDecoder().decode(value);
      expect(text).toContain("data: {");
      expect(text).toContain("Initial run event");

      await reader.cancel();
    });

    it("streams newly emitted events dynamically to active subscriber", async () => {
      const res = await fetch(`${baseUrl}/api/runs/${runId}/events`);
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) throw new Error("Expected reader to be defined");

      // Read initial queued event
      await reader.read();

      // Broadcast an event over defaultEventBus
      defaultEventBus.emit(runId, {
        type: "info",
        text: "Live streamed test event",
      });

      const { value, done } = await reader.read();
      expect(done).toBe(false);

      const text = new TextDecoder().decode(value);
      expect(text).toContain("Live streamed test event");

      await reader.cancel();
    });

    it("GET /api/runs/:id/events returns 404 for non-existent run", async () => {
      const res = await fetch(`${baseUrl}/api/runs/non-existent-sse/events`);
      expect(res.status).toBe(404);
    });
  });
});
