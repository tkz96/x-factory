// test/git-identity-inspection.test.ts — Git identity resolution at the
// inspection seam (spec #133, ticket #146).
//
// Git is a genuine external boundary, so these tests use REAL temporary git
// repositories and read the identity the same way the inspection reads every
// other git fact: `git config --get <key>` with the repository as `cwd`.
//
// The host's own git configuration is isolated away (GIT_CONFIG_GLOBAL /
// GIT_CONFIG_NOSYSTEM), so the answer can only come from the repository under
// inspection — a developer's global user.name must never be handed to a
// project as if it were the project's identity.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectLocalRepository } from "../src/inspection/index.js";
import { execStrict } from "../src/proc.js";
import { startServer } from "../src/server.js";

let baseDir: string;
let server: ReturnType<typeof startServer>;
let baseUrl: string;

const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
  X_FACTORY_DATA_DIR: process.env.X_FACTORY_DATA_DIR,
  X_FACTORY_CONFIG_PATH: process.env.X_FACTORY_CONFIG_PATH,
};

/** Restores one environment variable to the value it had before the suite. */
function restoreEnv(key: keyof typeof savedEnv): void {
  const original = savedEnv[key];
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

/** Creates a real git repository configured with exactly `identity`. */
async function makeRepo(
  name: string,
  identity: { name?: string; email?: string },
): Promise<string> {
  const dir = path.join(baseDir, name);
  await execStrict("git", ["init", dir]);
  if (identity.name !== undefined) {
    await execStrict("git", ["config", "user.name", identity.name], {
      cwd: dir,
    });
  }
  if (identity.email !== undefined) {
    await execStrict("git", ["config", "user.email", identity.email], {
      cwd: dir,
    });
  }
  return dir;
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-git-identity-"));

  // Only the inspected repository's own configuration may decide the answer.
  const emptyGlobalConfig = path.join(baseDir, "empty-gitconfig");
  await writeFile(emptyGlobalConfig, "");
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  // Decoys: an agent session's author overrides must never be read as the
  // project's identity.
  process.env.GIT_AUTHOR_NAME = "Environment Decoy Author";
  process.env.GIT_AUTHOR_EMAIL = "decoy@environment.invalid";

  // The route tests must never touch real workflow state.
  process.env.X_FACTORY_DATA_DIR = path.join(baseDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = path.join(
    baseDir,
    "config",
    "projects.json",
  );

  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  restoreEnv("GIT_CONFIG_GLOBAL");
  restoreEnv("GIT_CONFIG_NOSYSTEM");
  restoreEnv("GIT_AUTHOR_NAME");
  restoreEnv("GIT_AUTHOR_EMAIL");
  restoreEnv("X_FACTORY_DATA_DIR");
  restoreEnv("X_FACTORY_CONFIG_PATH");
  await rm(baseDir, { recursive: true, force: true });
});

describe("Git identity from the inspected repository's configuration (#146)", () => {
  it("resolves both values from the repository's git configuration, never from the environment", async () => {
    const dir = await makeRepo("configured-repo", {
      name: "Repo Owner",
      email: "owner@example.com",
    });

    const result = await inspectLocalRepository(dir);

    expect(result.gitIdentity).toEqual({
      name: "Repo Owner",
      email: "owner@example.com",
    });
    // The decoys are in the environment and were NOT used.
    expect(result.gitIdentity?.name).not.toBe(process.env.GIT_AUTHOR_NAME);
    expect(result.gitIdentity?.email).not.toBe(process.env.GIT_AUTHOR_EMAIL);
  });

  it("reads each repository's own identity, not one shared default", async () => {
    const first = await makeRepo("team-a", {
      name: "Team A",
      email: "team-a@example.com",
    });
    const second = await makeRepo("team-b", {
      name: "Team B",
      email: "team-b@example.com",
    });

    const [firstResult, secondResult] = await Promise.all([
      inspectLocalRepository(first),
      inspectLocalRepository(second),
    ]);

    expect(firstResult.gitIdentity).toEqual({
      name: "Team A",
      email: "team-a@example.com",
    });
    expect(secondResult.gitIdentity).toEqual({
      name: "Team B",
      email: "team-b@example.com",
    });
  });

  it("reports the identity as ABSENT when only the name is configured", async () => {
    const dir = await makeRepo("name-only", { name: "Half Configured" });

    const result = await inspectLocalRepository(dir);

    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    // Absent — not {name: "Half Configured", email: ""}, and not a default.
    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports the identity as ABSENT when only the email is configured", async () => {
    const dir = await makeRepo("email-only", { email: "half@example.com" });

    const result = await inspectLocalRepository(dir);

    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports the identity as ABSENT when neither value is configured", async () => {
    const dir = await makeRepo("unconfigured", {});

    const result = await inspectLocalRepository(dir);

    expect(result.exists).toBe(true);
    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports no identity for a path that does not exist", async () => {
    const result = await inspectLocalRepository(
      path.join(baseDir, "not-a-directory-12345"),
    );

    expect(result.exists).toBe(false);
    expect(result.gitIdentity).toBeUndefined();
  });

  it("surfaces the resolved identity through POST /api/projects/inspect-repository", async () => {
    const dir = await makeRepo("route-repo", {
      name: "Route Owner",
      email: "route@example.com",
    });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exists: boolean;
      gitIdentity?: { name: string; email: string };
    };
    expect(body.exists).toBe(true);
    expect(body.gitIdentity).toEqual({
      name: "Route Owner",
      email: "route@example.com",
    });
  });
});
