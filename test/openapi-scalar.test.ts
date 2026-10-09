// test/openapi-scalar.test.ts — Unit and route tests for OpenAPI 3.1.0 specification and Scalar API Reference integration.

import { beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Repositories } from "../src/composition-root.js";
import { getOpenApiSpec } from "../src/http/openapi.js";
import { handleApi } from "../src/http/routes.js";
import { serveStatic } from "../src/http/static.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

beforeEach(() => {
  repos = createTestRepositories();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

describe("OpenAPI 3.1 Specification Engine", () => {
  it("generates a valid OpenAPI 3.1.0 schema document", () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("X-Factory API");
    expect(spec.info.version).toBe("0.1.0");
    expect(Array.isArray(spec.servers)).toBe(true);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(Array.isArray(spec.tags)).toBe(true);
  });

  it("covers all core system endpoints in paths", () => {
    const spec = getOpenApiSpec();
    const paths = Object.keys(spec.paths);

    // Health
    expect(paths).toContain("/api/health");
    expect(spec.paths["/api/health"].get).toBeDefined();

    // Projects
    expect(paths).toContain("/api/projects");
    expect(spec.paths["/api/projects"].get).toBeDefined();
    expect(spec.paths["/api/projects"].post).toBeDefined();
    expect(paths).toContain("/api/projects/{id}");
    expect(spec.paths["/api/projects/{id}"].get).toBeDefined();
    expect(spec.paths["/api/projects/{id}"].post).toBeDefined();
    expect(spec.paths["/api/projects/{id}"].delete).toBeDefined();
    expect(paths).toContain("/api/projects/{id}/tickets");
    expect(paths).toContain("/api/projects/{id}/env");
    expect(paths).toContain("/api/projects/{id}/repos");
    expect(paths).toContain("/api/projects/{id}/test-connection");

    // Discovery & Inspection
    expect(paths).toContain("/api/projects/discover-repositories");
    expect(paths).toContain("/api/projects/inspect-repository");
    expect(paths).toContain("/api/projects/test-scopes");
    expect(paths).toContain("/api/projects/test-azure-scopes");
    expect(paths).toContain("/api/projects/check-path");

    // Runs
    expect(paths).toContain("/api/runs");
    expect(spec.paths["/api/runs"].get).toBeDefined();
    expect(spec.paths["/api/runs"].post).toBeDefined();
    expect(paths).toContain("/api/runs/{id}");
    expect(paths).toContain("/api/runs/{id}/events");
    expect(paths).toContain("/api/runs/{id}/steer");
    expect(paths).toContain("/api/runs/{id}/stop");
    expect(paths).toContain("/api/runs/{id}/pr");

    // Settings
    expect(paths).toContain("/api/settings");
    expect(spec.paths["/api/settings"].get).toBeDefined();
    expect(spec.paths["/api/settings"].post).toBeDefined();
  });

  it("defines essential reusable schemas in components", () => {
    const spec = getOpenApiSpec();
    const schemas = spec.components.schemas;
    expect(schemas.HealthResponse).toBeDefined();
    expect(schemas.Project).toBeDefined();
    expect(schemas.ProjectInput).toBeDefined();
    expect(schemas.ProjectReadiness).toBeDefined();
    expect(schemas.Ticket).toBeDefined();
    expect(schemas.DiscoveredRepository).toBeDefined();
    expect(schemas.Run).toBeDefined();
    expect(schemas.RunSummary).toBeDefined();
    expect(schemas.CreateRunRequest).toBeDefined();
    expect(schemas.SteerRunRequest).toBeDefined();
    expect(schemas.FactorySettings).toBeDefined();
    expect(schemas.ErrorResponse).toBeDefined();
  });

  it("documents the normalized connections creation contract (#131/#145)", () => {
    const spec = getOpenApiSpec();
    const schemas = spec.components.schemas;

    expect(schemas.ProjectCreationRequest).toBeDefined();
    expect(schemas.ProjectConnection).toBeDefined();
    expect(schemas.ProjectConnectionInput).toBeDefined();
    expect(schemas.ProjectRepositoryInput).toBeDefined();
    expect(schemas.ProjectConnectionUpdate).toBeDefined();
    expect(schemas.GitIdentity).toBeDefined();
    expect(schemas.FormErrorResponse).toBeDefined();

    // The creation payload carries the normalized connections, role-tagged
    // repositories and the project-level git identity.
    expect(Object.keys(schemas.ProjectCreationRequest.properties)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "gitIdentity",
        "connections",
        "repositories",
      ]),
    );
    expect(schemas.ProjectCreationRequest.required).toEqual(
      expect.arrayContaining(["id", "name", "connections", "repositories"]),
    );

    // A connection never exposes secret values in its stored representation.
    expect(Object.keys(schemas.ProjectConnection.properties)).toEqual([
      "providerId",
      "roles",
      "config",
    ]);

    // POST /api/projects accepts the creation payload and documents 201/400/409/500.
    const createResponses = spec.paths["/api/projects"].post.responses;
    expect(createResponses["201"]).toBeDefined();
    expect(createResponses["400"]).toBeDefined();
    expect(createResponses["409"]).toBeDefined();
    expect(createResponses["500"]).toBeDefined();
    expect(
      JSON.stringify(spec.paths["/api/projects"].post.requestBody),
    ).toContain("ProjectCreationRequest");

    // The project record exposes connections and the project-level git identity
    // (Project is composed from ProjectInput).
    expect(Object.keys(schemas.ProjectInput.properties)).toEqual(
      expect.arrayContaining(["connections", "gitIdentity"]),
    );
    expect(schemas.Project.allOf[0]?.$ref).toBe(
      "#/components/schemas/ProjectInput",
    );

    // The update contract documents clearSecrets.
    expect(Object.keys(schemas.ProjectConnectionUpdate.properties)).toContain(
      "clearSecrets",
    );
    expect(
      JSON.stringify(spec.paths["/api/projects/{id}"].post.requestBody),
    ).toContain("ProjectConnectionUpdate");
  });
});

describe("OpenAPI HTTP Endpoint Routing", () => {
  it("serves OpenAPI spec at /api/openapi.json", async () => {
    const req = new Request("http://localhost:3777/api/openapi.json");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    const data = await res.json();
    expect(data.openapi).toBe("3.1.0");
    expect(data.info.title).toBe("X-Factory API");
  });

  it("serves OpenAPI spec at /api/openapi alias", async () => {
    const req = new Request("http://localhost:3777/api/openapi");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.openapi).toBe("3.1.0");
  });
});

describe("Scalar Static Asset & Page Serving", () => {
  it("serves reference.html on /reference", async () => {
    const res = await serveStatic("/reference", PUBLIC_DIR);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")?.includes("text/html")).toBe(true);
    const html = await res.text();
    expect(html).toContain("SCALAR API REFERENCE");
    expect(html).toContain('data-url="/api/openapi.json"');
    expect(html).toContain("@scalar/api-reference");
  });

  it("serves reference.html on /reference/", async () => {
    const res = await serveStatic("/reference/", PUBLIC_DIR);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")?.includes("text/html")).toBe(true);
  });

  it("serves reference.html on /scalar alias", async () => {
    const res = await serveStatic("/scalar", PUBLIC_DIR);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")?.includes("text/html")).toBe(true);
  });

  it("serves reference.html on /api-docs alias", async () => {
    const res = await serveStatic("/api-docs", PUBLIC_DIR);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")?.includes("text/html")).toBe(true);
  });
});
