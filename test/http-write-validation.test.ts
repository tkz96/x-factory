// test/http-write-validation.test.ts — Request-body validation at the HTTP
// boundary (#163 B4): the legacy PUT /api/projects/{id} rejects a malformed
// body with 400 field errors instead of silently ignoring it, and an unwrapped
// handler's domain error still maps by family through handleApi (#163 B2).
//
// A temp config file and a temp data dir keep the repo's own inputs untouched.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiContext } from "../src/composition-root.js";
import { handleApi } from "../src/http/routes.js";
import { createTestRepositories } from "./helpers/composition.js";

let dataDir: string;
let configPath: string;
let repos: ApiContext["repos"];
let previousDataDir: string | undefined;
let previousConfigPath: string | undefined;

const PROJECT = {
  id: "put-app",
  name: "Put App",
  workspacePath: "/tmp/put-app",
  issueTracker: { provider: "github", connectionId: "github" },
  repositories: [
    {
      id: "put-app-web",
      name: "web",
      path: "/tmp/put-app/web",
      defaultBranch: "main",
      role: "frontend",
    },
  ],
};

function api(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  const req = new Request(`http://localhost:3777${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return handleApi(req, new URL(req.url), { repos });
}

beforeEach(async () => {
  previousDataDir = process.env.X_FACTORY_DATA_DIR;
  previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-write-validation-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  configPath = path.join(dataDir, "projects.json");
  process.env.X_FACTORY_CONFIG_PATH = configPath;
  await writeFile(
    configPath,
    `${JSON.stringify({ projects: [PROJECT] }, null, 2)}\n`,
    "utf-8",
  );
  repos = createTestRepositories();
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;
  await rm(dataDir, { recursive: true, force: true });
});

describe("PUT /api/projects/:id validation (#163 B4)", () => {
  test("rejects a wrong-typed testCommand with 400", async () => {
    const res = await api("PUT", "/api/projects/put-app", { testCommand: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  test("rejects an empty defaultBranch with 400", async () => {
    const res = await api("PUT", "/api/projects/put-app", {
      defaultBranch: "",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  test("accepts a valid legacy field update", async () => {
    const res = await api("PUT", "/api/projects/put-app", {
      name: "Put App Renamed",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Put App Renamed");
    const stored = JSON.parse(await readFile(configPath, "utf-8")) as {
      projects: Array<{ id: string; name: string }>;
    };
    expect(stored.projects.find((p) => p.id === "put-app")?.name).toBe(
      "Put App Renamed",
    );
  });

  test("an unwrapped handler's NotFoundError still maps to 404 through handleApi (#163 B2)", async () => {
    const res = await api("DELETE", "/api/projects/missing-app");
    expect(res.status).toBe(404);
  });
});
