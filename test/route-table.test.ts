// test/route-table.test.ts — the declarative route table drives dispatch and
// the OpenAPI document (#192).
//
// Seam: the HTTP API. Every request goes through `handleApi` with an in-memory
// repository bundle, against a temporary data/config dir. The table is compared
// with the generated document so a route that exists in dispatch but not in the
// published contract (or vice versa) fails here.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveProject, validateProject } from "../src/config.js";
import { getOpenApiSpec, ROUTE_TABLE } from "../src/http/route-table.js";
import { handleApi } from "../src/http/routes.js";
import { createTestRepositories } from "./helpers/composition.js";

let baseDir: string;
const savedEnv = {
  config: process.env.X_FACTORY_CONFIG_PATH,
  data: process.env.X_FACTORY_DATA_DIR,
};

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-route-table-"));
  process.env.X_FACTORY_CONFIG_PATH = path.join(baseDir, "projects.json");
  process.env.X_FACTORY_DATA_DIR = path.join(baseDir, "data");
});

afterAll(async () => {
  restoreEnv("X_FACTORY_CONFIG_PATH", savedEnv.config);
  restoreEnv("X_FACTORY_DATA_DIR", savedEnv.data);
  await rm(baseDir, { recursive: true, force: true });
});

function api(method: string, route: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:3777/api/${route}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return handleApi(new Request(url, init), url, {
    repos: createTestRepositories(),
  });
}

describe("the discovery and inspection namespaces no longer alias projects (#192)", () => {
  it("GET /api/discovery answers 404 instead of listing projects", async () => {
    const res = await api("GET", "discovery");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Endpoint not found." });
  });

  it("POST /api/inspection answers 404 instead of creating a project", async () => {
    const res = await api("POST", "inspection", { id: "x", name: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Endpoint not found." });
  });

  it("the removed discovery/inspection fall-through aliases answer 404", async () => {
    const aliases: Array<[string, string]> = [
      ["POST", "discovery/validate-path"],
      ["POST", "discovery/discover-repositories"],
      ["POST", "projects/quick-inspect"],
      ["POST", "projects/inspect"],
      ["POST", "projects/validate-path"],
    ];
    for (const [method, route] of aliases) {
      const res = await api(method, route, { path: baseDir });
      expect(res.status).toBe(404);
    }
  });

  it("keeps the canonical inspection and path-check routes", async () => {
    const inspect = await api("POST", "projects/inspect-repository", {
      path: baseDir,
    });
    expect(inspect.status).toBe(200);
    const check = await api("POST", "projects/check-path", { path: baseDir });
    expect(check.status).toBe(200);
  });
});

describe("a project whose id shadows a removed alias stays reachable (#192)", () => {
  it("routes GET/PUT /api/projects/discover and /api/projects/inspect to the project", async () => {
    for (const id of ["discover", "inspect"]) {
      await saveProject(
        validateProject({
          id,
          name: `Shadow ${id}`,
          repositoryPath: baseDir,
          defaultBranch: "main",
          testCommand: "bun test",
        }),
      );

      const get = await api("GET", `projects/${id}`);
      expect(get.status).toBe(200);
      expect(((await get.json()) as { id: string }).id).toBe(id);

      const put = await api("PUT", `projects/${id}`, {
        name: `Renamed ${id}`,
      });
      expect(put.status).toBe(200);
      expect(((await put.json()) as { name: string }).name).toBe(
        `Renamed ${id}`,
      );
    }
  });
});

describe("the OpenAPI document lists every route in the table (#192)", () => {
  it("documents every table method + path", () => {
    const spec = getOpenApiSpec();
    const paths = spec.paths as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const entry of ROUTE_TABLE) {
      expect(Object.keys(paths)).toContain(entry.path);
      expect(paths[entry.path]?.[entry.method.toLowerCase()]).toBeDefined();
    }
  });

  it("includes chat, transitions, readiness, diagnostics and docs", () => {
    const spec = getOpenApiSpec();
    const paths = spec.paths as unknown as Record<
      string,
      Record<string, unknown>
    >;
    expect(paths["/api/runs/{id}/chat"]?.post).toBeDefined();
    expect(paths["/api/runs/{id}/transitions"]?.post).toBeDefined();
    expect(paths["/api/readiness"]?.get).toBeDefined();
    expect(paths["/api/diagnostics"]?.get).toBeDefined();
    expect(paths["/api/docs"]?.get).toBeDefined();
    expect(paths["/api/health"]?.get).toBeDefined();
  });
});

describe("the request guard still runs ahead of dispatch (#219, #192)", () => {
  it("rejects a cross-origin POST before any route table entry sees it", async () => {
    const url = new URL("http://localhost:3777/api/inspection");
    const req = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
      },
      body: JSON.stringify({ id: "x" }),
    });
    const res = await handleApi(req, url, {
      repos: createTestRepositories(),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a non-JSON state-changing body on a real route with 415", async () => {
    const url = new URL("http://localhost:3777/api/runs");
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    const res = await handleApi(req, url, {
      repos: createTestRepositories(),
    });
    expect(res.status).toBe(415);
  });
});
