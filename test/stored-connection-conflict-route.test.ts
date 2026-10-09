// A stored project whose connection settings conflict answers 409, not 500 (#186).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleProjectsRoute } from "../src/http/projects-controller.js";
import { createTestRepositories } from "./helpers/composition.js";

let baseDir: string;
const savedConfigPath = process.env.X_FACTORY_CONFIG_PATH;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-conn-conflict-"));
  process.env.X_FACTORY_CONFIG_PATH = path.join(baseDir, "projects.json");
  await writeFile(
    process.env.X_FACTORY_CONFIG_PATH,
    JSON.stringify({
      projects: [
        {
          id: "stale",
          name: "Stale",
          workspacePath: baseDir,
          connections: [
            {
              providerId: "github",
              roles: ["tracker", "gitHost"],
              config: { repoOwner: "acme", gitHost: { owner: "other" } },
            },
          ],
          repositories: [
            {
              id: "stale-app",
              name: "app",
              path: baseDir,
              defaultBranch: "main",
              role: "backend",
            },
          ],
        },
      ],
    }),
    "utf-8",
  );
});

afterAll(async () => {
  if (savedConfigPath === undefined) delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = savedConfigPath;
  await rm(baseDir, { recursive: true, force: true });
});

describe("project routes with a conflicting stored connection", () => {
  for (const action of ["tracker", "tickets"] as const) {
    it(`GET /api/projects/stale/${action} answers 409 CONNECTION_CONFLICT`, async () => {
      const res = await handleProjectsRoute(
        "GET",
        "stale",
        action,
        3,
        new Request(`http://localhost:3777/api/projects/stale/${action}`),
        undefined,
        { repos: createTestRepositories() },
      );
      expect(res?.status).toBe(409);
      const body = (await res?.json()) as { code: string; error: string };
      expect(body.code).toBe("CONNECTION_CONFLICT");
      expect(body.error).toContain("conflicting settings");
    });
  }
});
