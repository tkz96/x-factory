// test/integration.test.ts — Lightweight integration tests validating server startup, static asset delivery, health check, and core API contracts.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getEventRepository, getRunRepository } from "../src/runs.js";
import { type ServerInstance, startServer } from "../src/server.js";

let server: ServerInstance;
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

    it("serves sprite.svg on GET /assets/icons/sprite.svg with image/svg+xml MIME type", async () => {
      const res = await fetch(`${baseUrl}/assets/icons/sprite.svg`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/svg+xml");

      const text = await res.text();
      expect(text).toContain('<symbol id="icon-layers"');
      expect(text).toContain('<symbol id="icon-azure"');
    });

    it("returns 404 for unknown static file", async () => {
      const res = await fetch(`${baseUrl}/non-existent-asset.xyz`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for missing .js files without falling back to source in production", async () => {
      const res = await fetch(`${baseUrl}/missing-script.js`);
      expect(res.status).toBe(404);
    });
    it("serves reference.html on GET /reference with Scalar configuration", async () => {
      const res = await fetch(`${baseUrl}/reference`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("SCALAR API REFERENCE");
      expect(html).toContain('data-url="/api/openapi.json"');
      expect(html).toContain("@scalar/api-reference");
    });

    it("serves reference.html on GET /scalar alias", async () => {
      const res = await fetch(`${baseUrl}/scalar`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    });

    it("serves OpenAPI 3.1 spec on GET /api/openapi.json", async () => {
      const res = await fetch(`${baseUrl}/api/openapi.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );

      const data = await res.json();
      expect(data.openapi).toBe("3.1.0");
      expect(data.info.title).toBe("X-Factory API");
    });

    it("serves OpenAPI 3.1 spec on root GET /openapi.json", async () => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );

      const data = await res.json();
      expect(data.openapi).toBe("3.1.0");
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
      const runRepo = getRunRepository();
      runRepo.create({
        id: runId,
        projectId: "p1",
        projectName: "Test Project",
        ticket: { id: "T-1", title: "Test Ticket", acceptanceCriteria: [] },
        plan: "Test Plan",
        branch: "factory/t-1",
        status: "executing",
        artifactsDir: "/tmp",
        worktreePath: "/tmp",
      });
      getEventRepository().appendEvent(runId, "info", {
        text: "Initial run event",
      });
    });

    afterAll(() => {
      getRunRepository().delete(runId);
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

      // Append an event to SQLite
      getEventRepository().appendEvent(runId, "info", {
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

  describe("Scope Diagnostics API — the project-scoped tracker action (#183)", () => {
    // The flat body-driven routes are deleted. "Verify scopes" on an existing
    // project is `POST /api/projects/{id}/tracker/scopes`, which probes the
    // project's STORED connection; the request body carries no configuration.
    it("no longer serves the flat test-scopes / test-azure-scopes routes", async () => {
      for (const route of ["test-scopes", "test-azure-scopes"]) {
        const res = await fetch(`${baseUrl}/api/projects/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId: "jira" }),
        });

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Endpoint not found." });
      }
    });

    it("answers 404 for a project that is not recorded", async () => {
      const res = await fetch(
        `${baseUrl}/api/projects/no-such-project/tracker/scopes`,
        { method: "POST" },
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'Project "no-such-project" not found.',
      });
    });

    it("probes the stored tracker connection of a real project (shipped registry)", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "xf-183-scopes-"));
      const savedConfigPath = process.env.X_FACTORY_CONFIG_PATH;
      process.env.X_FACTORY_CONFIG_PATH = path.join(dir, "projects.json");
      try {
        const created = await fetch(`${baseUrl}/api/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "integration-183",
            name: "Integration 183",
            workspacePath: dir,
            connections: [
              {
                providerId: "jira",
                roles: ["tracker"],
                config: {
                  host: "https://rocket.atlassian.net",
                  email: "dev@example.com",
                  apiToken: "jira-marker",
                  project: "ROCKET",
                },
              },
              {
                providerId: "github",
                roles: ["gitHost"],
                config: {
                  token: "ghp-marker",
                  repoOwner: "acme",
                  repository: "web",
                },
              },
            ],
            repositories: [
              {
                id: "integration-183-web",
                name: "web",
                remote: "https://github.com/acme/web.git",
                defaultBranch: "main",
                localPath: path.join(dir, "web"),
                role: "backend",
                primary: true,
              },
            ],
          }),
        });
        expect(created.status).toBe(201);

        // Jira ships WITHOUT `verifyScopes`: the stored connection resolved, the
        // capability was asked for, and the gap is reported honestly in
        // provider-agnostic copy — never substituted for.
        const res = await fetch(
          `${baseUrl}/api/projects/integration-183/tracker/scopes`,
          { method: "POST" },
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({
          ok: false,
          overPrivileged: false,
          scopes: {},
          errors: [
            "The resolved tracker provider does not support scope verification.",
          ],
          warnings: [],
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("jira");
      } finally {
        if (savedConfigPath === undefined) {
          delete process.env.X_FACTORY_CONFIG_PATH;
        } else {
          process.env.X_FACTORY_CONFIG_PATH = savedConfigPath;
        }
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
